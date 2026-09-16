package com.sms.gateway.receiver

import android.app.Activity
import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.util.Log
import com.sms.gateway.manager.ReceiptAggregator
import com.sms.gateway.manager.SupabaseManager
import com.sms.gateway.model.ActivityLogManager
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch

class SmsStatusReceiver : BroadcastReceiver() {
    override fun onReceive(context: Context, intent: Intent) {
        val messageId = intent.data?.host ?: intent.getStringExtra("message_id") ?: return
        val action = intent.action ?: return
        val partIndex = intent.getIntExtra("part_index", 0)
        val partCount = intent.getIntExtra("part_count", 1)
        val resultCode = resultCode

        Log.d(TAG, "Received status intent for $messageId: $action part $partIndex/$partCount (result: $resultCode)")

        // P9: goAsync gives us ~10s of process lifetime so the network report
        // survives; ReportOutbox catches anything that still fails.
        val pendingResult = goAsync()
        CoroutineScope(Dispatchers.IO).launch {
            try {
                when (action) {
                    "com.sms.gateway.SMS_SENT" -> {
                        // H1: aggregate per-part results; only report ONE
                        // terminal outcome per message.
                        val terminal = ReceiptAggregator.recordSentPart(
                            messageId, partIndex, partCount, resultCode
                        ) ?: return@launch

                        if (terminal.success) {
                            ActivityLogManager.updateStatus(messageId, "SENT")
                            SupabaseManager.reportSmsResultReliable(messageId, "sent")
                        } else {
                            ActivityLogManager.updateStatus(messageId, "FAILED", terminal.errorMessage)
                            SupabaseManager.reportSmsResultReliable(
                                messageId = messageId,
                                status = "failed",
                                errorCode = terminal.errorCode,
                                errorMessage = terminal.errorMessage
                            )
                        }
                    }

                    "com.sms.gateway.SMS_DELIVERED" -> {
                        if (resultCode == Activity.RESULT_OK) {
                            ActivityLogManager.updateStatus(messageId, "DELIVERED")
                            SupabaseManager.reportSmsResultReliable(messageId, "delivered")
                        }
                    }
                }
            } finally {
                pendingResult.finish()
            }
        }
    }

    companion object {
        private const val TAG = "SmsStatusReceiver"
    }
}
