package com.sms.gateway.manager

import android.app.PendingIntent
import android.content.Context
import android.content.Intent
import android.net.Uri
import android.os.Build
import android.telephony.SmsManager
import android.telephony.SubscriptionManager
import android.util.Log
import com.sms.gateway.model.ActivityLog
import com.sms.gateway.model.ActivityLogManager
import kotlinx.coroutines.delay
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock

object SmsDispatcher {
    private const val TAG = "SmsDispatcher"
    private const val SEND_INTERVAL_MS = 2_000L

    // Shared pacing token bucket across the service drain AND FCM drain (H4):
    // two entry paths can never exceed one message per interval.
    private val sendMutex = Mutex()
    @Volatile private var lastSendAt = 0L

    suspend fun sendSms(
        context: Context,
        messageId: String,
        phoneNumber: String,
        messageText: String,
        simSlot: Int?
    ) {
        ActivityLogManager.addLog(
            ActivityLog(
                id = messageId,
                phoneNumber = phoneNumber,
                message = messageText,
                simSlot = simSlot ?: 0,
                status = "PROCESSING"
            )
        )

        // H2: fail loudly when the pinned SIM slot has no active subscription.
        // Never silently re-route via the default SIM — the server has already
        // recorded the requested SIM as the sender.
        val smsManager = getSmsManagerForSlot(context, simSlot)
        if (smsManager == null) {
            val errorMessage = "Requested SIM slot $simSlot has no active subscription"
            Log.w(TAG, errorMessage)
            ActivityLogManager.updateStatus(messageId, "FAILED", errorMessage)
            SupabaseManager.reportSmsResultReliable(
                messageId = messageId,
                status = "failed",
                errorCode = 9001,
                errorMessage = errorMessage
            )
            return
        }

        val parts = smsManager.divideMessage(messageText)
        val partCount = parts.size

        val flag = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
            PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_MUTABLE
        } else {
            PendingIntent.FLAG_UPDATE_CURRENT
        }

        Log.d(TAG, "Dispatching SMS $messageId in $partCount part(s) via SIM slot $simSlot to $phoneNumber")

        // Pacing happens inside the shared mutex so the FCM path and the
        // service path are serialized against the same clock (H4).
        sendMutex.withLock {
            val sinceLast = System.currentTimeMillis() - lastSendAt
            if (sinceLast < SEND_INTERVAL_MS) {
                delay(SEND_INTERVAL_MS - sinceLast)
            }
            lastSendAt = System.currentTimeMillis()

            try {
                if (partCount <= 1) {
                    smsManager.sendTextMessage(
                        phoneNumber,
                        null,
                        messageText,
                        buildPendingIntent(context, messageId, 0, partCount, "com.sms.gateway.SMS_SENT", flag),
                        buildPendingIntent(context, messageId, 0, partCount, "com.sms.gateway.SMS_DELIVERED", flag)
                    )
                } else {
                    // H1: one PendingIntent PER PART (unique requestCode + part
                    // extras) so each part's broadcast can be aggregated.
                    val sentIntents = ArrayList<PendingIntent>(partCount)
                    val deliveredIntents = ArrayList<PendingIntent>(partCount)
                    for (index in 0 until partCount) {
                        sentIntents.add(
                            buildPendingIntent(context, messageId, index, partCount, "com.sms.gateway.SMS_SENT", flag)
                        )
                        deliveredIntents.add(
                            buildPendingIntent(context, messageId, index, partCount, "com.sms.gateway.SMS_DELIVERED", flag)
                        )
                    }
                    smsManager.sendMultipartTextMessage(
                        phoneNumber,
                        null,
                        parts,
                        sentIntents,
                        deliveredIntents
                    )
                }
            } catch (e: Exception) {
                Log.e(TAG, "Direct transmission failure", e)
                ActivityLogManager.updateStatus(messageId, "FAILED", e.message)
                SupabaseManager.reportSmsResultReliable(
                    messageId = messageId,
                    status = "failed",
                    errorCode = SmsManager.RESULT_ERROR_GENERIC_FAILURE,
                    errorMessage = e.message ?: "Exception sending SMS"
                )
            }
        }
    }

    private fun buildPendingIntent(
        context: Context,
        messageId: String,
        partIndex: Int,
        partCount: Int,
        action: String,
        flag: Int
    ): PendingIntent {
        // Unique requestCode per part prevents both cross-message collisions
        // and part-over-part overwrites (H1).
        val requestCode = messageId.hashCode() * 31 + partIndex
        return PendingIntent.getBroadcast(
            context,
            requestCode,
            Intent(action).apply {
                data = Uri.parse("sms://$messageId")
                putExtra("message_id", messageId)
                putExtra("part_index", partIndex)
                putExtra("part_count", partCount)
                setPackage(context.packageName)
            },
            flag
        )
    }

    /**
     * Returns the SmsManager for the requested slot, or null when the slot has
     * no active subscription (H2 — callers must fail instead of re-routing).
     */
    private fun getSmsManagerForSlot(context: Context, simSlot: Int?): SmsManager? {
        if (simSlot != null) {
            try {
                val subManager = context.getSystemService(SubscriptionManager::class.java)
                val subList = subManager?.activeSubscriptionInfoList
                val subInfo = subList?.find { it.simSlotIndex == simSlot }
                if (subInfo != null) {
                    val subId = subInfo.subscriptionId
                    Log.d(TAG, "Selected subId $subId for SIM slot $simSlot (${subInfo.displayName ?: subInfo.carrierName})")
                    return if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
                        context.getSystemService(SmsManager::class.java).createForSubscriptionId(subId)
                    } else {
                        @Suppress("DEPRECATION")
                        SmsManager.getSmsManagerForSubscriptionId(subId)
                    }
                }
                Log.w(TAG, "No active subscription found for SIM slot $simSlot in ${subList?.size ?: 0} active subscriptions")
                return null
            } catch (e: Exception) {
                Log.w(TAG, "Could not acquire subscription for SIM slot $simSlot", e)
                return null
            }
        }
        return if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
            context.getSystemService(SmsManager::class.java)
        } else {
            @Suppress("DEPRECATION")
            SmsManager.getDefault()
        }
    }
}

