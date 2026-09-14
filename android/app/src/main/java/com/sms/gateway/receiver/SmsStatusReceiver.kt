package com.sms.gateway.receiver

import android.app.Activity
import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.telephony.SmsManager
import android.util.Log
import com.sms.gateway.manager.SupabaseManager
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch

class SmsStatusReceiver : BroadcastReceiver() {
    override fun onReceive(context: Context, intent: Intent) {
        val messageId = intent.data?.host ?: intent.getStringExtra("message_id") ?: return
        val action = intent.action ?: return
        val resultCode = resultCode

        Log.d(TAG, "Received status intent for $messageId: $action (result: $resultCode)")

        CoroutineScope(Dispatchers.IO).launch {
            when (action) {
                "com.sms.gateway.SMS_SENT" -> {
                    if (resultCode == Activity.RESULT_OK) {
                        SupabaseManager.reportSmsResult(
                            messageId = messageId,
                            status = "sent"
                        )
                    } else {
                        val errorMessage = when (resultCode) {
                            SmsManager.RESULT_ERROR_NO_SERVICE -> "No cellular reception"
                            SmsManager.RESULT_ERROR_RADIO_OFF -> "Radio off / Airplane mode active"
                            SmsManager.RESULT_ERROR_LIMIT_EXCEEDED -> "Android OS SMS rate limit exceeded"
                            SmsManager.RESULT_ERROR_NULL_PDU -> "Null PDU received from carrier"
                            else -> "Carrier rejection (error code $resultCode)"
                        }
                        SupabaseManager.reportSmsResult(
                            messageId = messageId,
                            status = "failed",
                            errorCode = resultCode,
                            errorMessage = errorMessage
                        )
                    }
                }

                "com.sms.gateway.SMS_DELIVERED" -> {
                    if (resultCode == Activity.RESULT_OK) {
                        SupabaseManager.reportSmsResult(
                            messageId = messageId,
                            status = "delivered"
                        )
                    }
                }
            }
        }
    }

    companion object {
        private const val TAG = "SmsStatusReceiver"
    }
}
