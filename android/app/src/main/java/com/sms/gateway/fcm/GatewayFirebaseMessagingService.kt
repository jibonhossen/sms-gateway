package com.sms.gateway.fcm

import android.content.Context
import android.os.Build
import android.os.PowerManager
import android.util.Log
import com.google.firebase.messaging.FirebaseMessagingService
import com.google.firebase.messaging.RemoteMessage
import com.sms.gateway.GatewayApp
import com.sms.gateway.manager.SmsDispatcher
import com.sms.gateway.manager.SupabaseManager
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch

class GatewayFirebaseMessagingService : FirebaseMessagingService() {

    override fun onNewToken(token: String) {
        super.onNewToken(token)
        Log.d(TAG, "New FCM token received")
        GatewayApp.instance.fcmToken = token

        if (GatewayApp.instance.hasDeviceCredentials) {
            CoroutineScope(Dispatchers.IO).launch {
                SupabaseManager.updateFcmToken(token)
            }
        }
    }

    override fun onMessageReceived(remoteMessage: RemoteMessage) {
        super.onMessageReceived(remoteMessage)
        Log.d(TAG, "FCM message received from: ${remoteMessage.from}, data: ${remoteMessage.data}")

        CoroutineScope(Dispatchers.IO).launch {
            // Bounded wakelock sized to the batch: 10 messages x 2s pacing + slack (H3)
            val powerManager = getSystemService(Context.POWER_SERVICE) as PowerManager
            val wakeLock = powerManager.newWakeLock(
                PowerManager.PARTIAL_WAKE_LOCK,
                "SmsGateway::FcmWakeLock"
            ).apply { acquire(MAX_BATCH * 3_000L + 30_000L) }

            try {
                if (!GatewayApp.instance.isPaired) {
                    Log.w(TAG, "Device is not paired. Ignoring FCM wakeup.")
                    return@launch
                }

                // H3: the main thread is never blocked (background coroutine instead of
                // runBlocking); the drain is bounded to MAX_BATCH messages —
                // anything left stays queued for the next wake-up/poll, which
                // also keeps every claimed message far inside its 15-minute
                // lease (C4).
                var drainedCount = 0
                while (drainedCount < MAX_BATCH) {
                    val message = SupabaseManager.claimNextSms() ?: break
                    drainedCount++
                    Log.d(TAG, "FCM Drain #$drainedCount: Claimed ${message.messageId} for SIM ${message.simSlot}")
                    SmsDispatcher.sendSms(
                        context = applicationContext,
                        messageId = message.messageId,
                        phoneNumber = message.phoneNumber,
                        messageText = message.message,
                        simSlot = message.simSlot
                    )
                }
                Log.d(TAG, "FCM background drain completed. Total processed: $drainedCount")

                // Only attempt to start the persistent foreground service when
                // the OS allows background FGS starts (H3).
                if (Build.VERSION.SDK_INT < Build.VERSION_CODES.S) {
                    try {
                        com.sms.gateway.service.SmsGatewayService.start(applicationContext)
                    } catch (e: Exception) {
                        Log.w(TAG, "Foreground service start note: ${e.message}")
                    }
                }
            } catch (e: Exception) {
                Log.e(TAG, "Error in FCM background queue drain", e)
            } finally {
                if (wakeLock.isHeld) wakeLock.release()
            }
        }
    }

    companion object {
        private const val TAG = "GatewayFCM"
        private const val MAX_BATCH = 10
    }
}
