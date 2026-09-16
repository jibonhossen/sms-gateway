package com.sms.gateway.receiver

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.provider.Telephony
import android.telephony.SubscriptionManager
import android.util.Log
import com.sms.gateway.GatewayApp
import com.sms.gateway.manager.SupabaseManager
import com.sms.gateway.model.ActivityLog
import com.sms.gateway.model.ActivityLogManager
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import java.security.MessageDigest

class SmsIncomingReceiver : BroadcastReceiver() {
    override fun onReceive(context: Context, intent: Intent) {
        if (intent.action != Telephony.Sms.Intents.SMS_RECEIVED_ACTION) return
        if (!GatewayApp.instance.hasDeviceCredentials) return

        val messages = Telephony.Sms.Intents.getMessagesFromIntent(intent) ?: return
        if (messages.isEmpty()) return

        val firstMessage = messages.first()
        val sender = firstMessage.displayOriginatingAddress ?: return
        val fullBody = messages.joinToString("") { it.displayMessageBody ?: "" }

        val simSlot = resolveSimSlot(context, intent)

        Log.d(TAG, "Incoming SMS from $sender on resolved SIM slot $simSlot")

        // P10: idempotency key — sha256(sender | body | slot | minute-bucket).
        // Server enforces a unique index, so SMSC redeliveries are dropped.
        val minuteBucket = System.currentTimeMillis() / 60_000
        val idemKey = sha256("$sender|$fullBody|$simSlot|$minuteBucket")

        val logId = idemKey
        ActivityLogManager.addLog(
            ActivityLog(
                id = logId,
                phoneNumber = sender,
                message = fullBody,
                simSlot = simSlot,
                status = "INBOUND"
            )
        )

        // P9: goAsync keeps the process alive until the insert lands; failures
        // persist to the local outbox and are retried by the service loop.
        val pendingResult = goAsync()
        CoroutineScope(Dispatchers.IO).launch {
            try {
                SupabaseManager.recordInboundSmsReliable(
                    sender = sender,
                    message = fullBody,
                    simSlot = simSlot,
                    idemKey = idemKey
                )
            } finally {
                pendingResult.finish()
            }
        }
    }

    private fun sha256(input: String): String {
        val digest = MessageDigest.getInstance("SHA-256").digest(input.toByteArray())
        return digest.joinToString("") { "%02x".format(it) }
    }

    private fun resolveSimSlot(context: Context, intent: Intent): Int {
        // Method 1: Check SubscriptionManager by subscription ID extra
        try {
            val subId = intent.getIntExtra("subscription", -1)
            if (subId != -1) {
                val subManager = context.getSystemService(SubscriptionManager::class.java)
                val subInfo = subManager?.getActiveSubscriptionInfo(subId)
                if (subInfo != null) {
                    return subInfo.simSlotIndex
                }
            }
        } catch (e: Exception) {
            Log.w(TAG, "Failed resolving slot via SubscriptionManager", e)
        }

        // Method 2: Check common OEM extras (Samsung, MediaTek, Qualcomm, Spreadtrum)
        val oemKeys = arrayOf("simId", "slot", "sim_slot", "sim_id", "slot_id", "android.telephony.extra.SLOT_INDEX", "phone")
        for (key in oemKeys) {
            val slot = intent.getIntExtra(key, -1)
            if (slot in 0..1) {
                return slot
            }
        }

        return 0
    }

    companion object {
        private const val TAG = "SmsIncomingReceiver"
    }
}
