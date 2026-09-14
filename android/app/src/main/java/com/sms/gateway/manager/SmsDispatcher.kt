package com.sms.gateway.manager

import android.app.PendingIntent
import android.content.Context
import android.content.Intent
import android.net.Uri
import android.os.Build
import android.telephony.SmsManager
import android.telephony.SubscriptionManager
import android.util.Log
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

        val smsManager = getSmsManagerForSlot(context, simSlot)

        // Sent PendingIntent (Cellular handoff)
        val sentIntent = PendingIntent.getBroadcast(
            context,
            messageId.hashCode(),
            Intent("com.sms.gateway.SMS_SENT").apply {
                data = Uri.parse("sms://$messageId")
                setPackage(context.packageName)
            },
            PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE
        )

        // Delivery PendingIntent (Carrier SMSC DLR)
        val deliveredIntent = PendingIntent.getBroadcast(
            context,
            messageId.hashCode(),
            Intent("com.sms.gateway.SMS_DELIVERED").apply {
                data = Uri.parse("sms://$messageId")
                setPackage(context.packageName)
            },
            PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE
        )

        val parts = smsManager.divideMessage(messageText)
        val sentIntents = ArrayList(List(parts.size) { sentIntent })
        val deliveredIntents = ArrayList(List(parts.size) { deliveredIntent })

        Log.d(TAG, "Dispatching SMS $messageId in ${parts.size} part(s) via SIM slot $simSlot to $phoneNumber")

        try {
            smsManager.sendMultipartTextMessage(
                phoneNumber,
                null,
                parts,
                sentIntents,
                deliveredIntents
            )
        } catch (e: Exception) {
            Log.e(TAG, "Direct transmission failure", e)
            SupabaseManager.reportSmsResult(
                messageId = messageId,
                status = "failed",
                errorMessage = e.message ?: "Exception sending SMS"
            )
        }
    }

    private fun getSmsManagerForSlot(context: Context, simSlot: Int?): SmsManager {
        if (simSlot != null && Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
            try {
                val subManager = context.getSystemService(SubscriptionManager::class.java)
                val subInfo = subManager.getActiveSubscriptionInfoForSimSlotIndex(simSlot)
                if (subInfo != null) {
                    return context.getSystemService(SmsManager::class.java)
                        .createForSubscriptionId(subInfo.subscriptionId)
                }
            } catch (e: Exception) {
                Log.w(TAG, "Could not acquire subscription for SIM slot $simSlot, using default", e)
            }
        }
        return SmsManager.getDefault()
    }
}
