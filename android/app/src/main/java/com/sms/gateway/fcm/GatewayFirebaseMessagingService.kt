package com.sms.gateway.fcm

import android.content.Context
import android.os.PowerManager
import android.util.Log
import com.google.firebase.messaging.FirebaseMessagingService
import com.google.firebase.messaging.RemoteMessage
import com.sms.gateway.GatewayApp
import com.sms.gateway.manager.SmsDispatcher
import com.sms.gateway.manager.SupabaseManager
import com.sms.gateway.service.SmsGatewayService
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.isActive
import kotlinx.coroutines.launch

class GatewayFirebaseMessagingService : FirebaseMessagingService() {

    override fun onNewToken(token: String) {
        super.onNewToken(token)
        Log.d(TAG, "New FCM token received: $token")
        GatewayApp.instance.fcmToken = token

        if (GatewayApp.instance.isPaired) {
            CoroutineScope(Dispatchers.IO).launch {
                SupabaseManager.updateFcmToken(token)
            }
        }
    }

    override fun onMessageReceived(remoteMessage: RemoteMessage) {
        super.onMessageReceived(remoteMessage)
        Log.d(TAG, "FCM message received from: ${remoteMessage.from}, data: ${remoteMessage.data}")

        val action = remoteMessage.data["action"] ?: "DRAIN_QUEUE"
        Log.d(TAG, "Processing FCM high-priority action: $action")

        val powerManager = getSystemService(Context.POWER_SERVICE) as PowerManager
        val wakeLock = powerManager.newWakeLock(
            PowerManager.PARTIAL_WAKE_LOCK,
            "SmsGateway::FcmWakeLock"
        ).apply {
            acquire(30000L) // 30s safety timeout for processing batch
        }

        try {
            kotlinx.coroutines.runBlocking(Dispatchers.IO) {
                if (GatewayApp.instance.isPaired) {
                    Log.d(TAG, "Starting headless background queue drain via FCM wakeup...")
                    var drainedCount = 0
                    while (isActive) {
                        val message = SupabaseManager.claimNextSms() ?: break
                        drainedCount++
                        Log.d(TAG, "FCM Drain #$drainedCount: Claimed message ${message.messageId} for SIM ${message.simSlot}")
                        SmsDispatcher.sendSms(
                            context = applicationContext,
                            messageId = message.messageId,
                            phoneNumber = message.phoneNumber,
                            messageText = message.message,
                            simSlot = message.simSlot
                        )
                    }
                    Log.d(TAG, "FCM background drain completed. Total processed: $drainedCount")

                    // Also try starting persistent foreground service if allowed by OS
                    try {
                        SmsGatewayService.start(applicationContext)
                    } catch (e: Exception) {
                        Log.w(TAG, "Foreground service start note: ${e.message}")
                    }
                } else {
                    Log.w(TAG, "Device is not paired. Ignoring FCM wakeup.")
                }
            }
        } catch (e: Exception) {
            Log.e(TAG, "Error in FCM background queue drain", e)
        } finally {
            if (wakeLock.isHeld) {
                wakeLock.release()
            }
        }
    }

    companion object {
        private const val TAG = "GatewayFCM"
    }
}
