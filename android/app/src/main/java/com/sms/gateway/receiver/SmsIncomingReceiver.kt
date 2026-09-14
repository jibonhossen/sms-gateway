package com.sms.gateway.receiver

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.provider.Telephony
import android.telephony.SubscriptionManager
import android.util.Log
import com.sms.gateway.GatewayApp
import com.sms.gateway.manager.SupabaseManager
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch

class SmsIncomingReceiver : BroadcastReceiver() {
    override fun onReceive(context: Context, intent: Intent) {
        if (intent.action != Telephony.Sms.Intents.SMS_RECEIVED_ACTION) return
        if (!GatewayApp.instance.isPaired) return

        val messages = Telephony.Sms.Intents.getMessagesFromIntent(intent) ?: return
        if (messages.isEmpty()) return

        val firstMessage = messages.first()
        val sender = firstMessage.displayOriginatingAddress ?: return
        val fullBody = messages.joinToString("") { it.displayMessageBody ?: "" }

        // Extract SIM slot if multi-SIM device
        val subId = intent.getIntExtra(
            "subscription",
            SubscriptionManager.getDefaultSubscriptionId()
        )
        val simSlot = intent.getIntExtra("simId", 0)

        Log.d(TAG, "Incoming SMS from $sender on SIM slot $simSlot")

        CoroutineScope(Dispatchers.IO).launch {
            SupabaseManager.recordInboundSms(
                sender = sender,
                message = fullBody,
                simSlot = simSlot
            )
        }
    }

    companion object {
        private const val TAG = "SmsIncomingReceiver"
    }
}
