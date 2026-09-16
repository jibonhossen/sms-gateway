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

object SmsDispatcher {
    private const val TAG = "SmsDispatcher"

    suspend fun sendSms(
        context: Context,
        messageId: String,
        phoneNumber: String,
        messageText: String,
        simSlot: Int?
    ) {
        // Enforce 2-second safety pacing throttle between consecutive messages
        delay(2000L)

        val resolvedSlot = simSlot ?: 0
        ActivityLogManager.addLog(
            ActivityLog(
                id = messageId,
                phoneNumber = phoneNumber,
                message = messageText,
                simSlot = resolvedSlot,
                status = "PROCESSING"
            )
        )

        val smsManager = getSmsManagerForSlot(context, simSlot)

        val flag = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
            PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_MUTABLE
        } else {
            PendingIntent.FLAG_UPDATE_CURRENT
        }

        val parts = smsManager.divideMessage(messageText)
        val partCount = parts.size

        // Sent PendingIntent (Cellular handoff)
        val sentIntent = PendingIntent.getBroadcast(
            context,
            messageId.hashCode(),
            Intent("com.sms.gateway.SMS_SENT").apply {
                data = Uri.parse("sms://$messageId")
                putExtra("message_id", messageId)
                putExtra("part_count", partCount)
                setPackage(context.packageName)
            },
            flag
        )

        // Delivery PendingIntent (Carrier SMSC DLR)
        val deliveredIntent = PendingIntent.getBroadcast(
            context,
            messageId.hashCode(),
            Intent("com.sms.gateway.SMS_DELIVERED").apply {
                data = Uri.parse("sms://$messageId")
                putExtra("message_id", messageId)
                putExtra("part_count", partCount)
                setPackage(context.packageName)
            },
            flag
        )

        val sentIntents = ArrayList(List(partCount) { sentIntent })
        val deliveredIntents = ArrayList(List(partCount) { deliveredIntent })

        Log.d(TAG, "Dispatching SMS $messageId in $partCount part(s) via SIM slot $simSlot to $phoneNumber")

        try {
            if (partCount <= 1) {
                smsManager.sendTextMessage(
                    phoneNumber,
                    null,
                    messageText,
                    sentIntent,
                    deliveredIntent
                )
            } else {
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
            SupabaseManager.reportSmsResult(
                messageId = messageId,
                status = "failed",
                errorMessage = e.message ?: "Exception sending SMS"
            )
        }
    }

    private fun getSmsManagerForSlot(context: Context, simSlot: Int?): SmsManager {
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
                } else {
                    Log.w(TAG, "No active subscription found for SIM slot $simSlot in ${subList?.size ?: 0} active subscriptions")
                }
            } catch (e: Exception) {
                Log.w(TAG, "Could not acquire subscription for SIM slot $simSlot, using default", e)
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
