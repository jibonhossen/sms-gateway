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
import java.util.UUID

class SmsIncomingReceiver : BroadcastReceiver() {
    override fun onReceive(context: Context, intent: Intent) {
        if (intent.action != Telephony.Sms.Intents.SMS_RECEIVED_ACTION) return
        if (!GatewayApp.instance.isPaired) return

        val messages = Telephony.Sms.Intents.getMessagesFromIntent(intent) ?: return
        if (messages.isEmpty()) return

        val firstMessage = messages.first()
        val sender = firstMessage.displayOriginatingAddress ?: return
        val fullBody = messages.joinToString("") { it.displayMessageBody ?: "" }

        val simSlot = resolveSimSlot(context, intent)

        Log.d(TAG, "Incoming SMS from $sender on resolved SIM slot $simSlot")

        val logId = UUID.randomUUID().toString()
        ActivityLogManager.addLog(
            ActivityLog(
                id = logId,
                phoneNumber = sender,
                message = fullBody,
                simSlot = simSlot,
                status = "INBOUND"
            )
        )

        CoroutineScope(Dispatchers.IO).launch {
            SupabaseManager.recordInboundSms(
                sender = sender,
                message = fullBody,
                simSlot = simSlot
            )
        }
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
