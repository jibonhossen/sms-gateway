package com.sms.gateway.service

import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.app.Service
import android.content.Context
import android.content.Intent
import android.content.IntentFilter
import android.net.ConnectivityManager
import android.net.Network
import android.net.NetworkCapabilities
import android.net.NetworkRequest
import android.os.BatteryManager
import android.os.Build
import android.os.IBinder
import android.os.PowerManager
import android.util.Log
import androidx.core.app.NotificationCompat
import com.sms.gateway.GatewayApp
import com.sms.gateway.MainActivity
import com.sms.gateway.R
import com.sms.gateway.manager.SmsDispatcher
import com.sms.gateway.manager.SupabaseManager
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.cancel
import kotlinx.coroutines.delay
import kotlinx.coroutines.isActive
import kotlinx.coroutines.launch

class SmsGatewayService : Service() {
    private val serviceJob = SupervisorJob()
    private val scope = CoroutineScope(Dispatchers.IO + serviceJob)

    private var wakeLock: PowerManager.WakeLock? = null
    private var isQueueProcessing = false
    private var networkCallback: ConnectivityManager.NetworkCallback? = null

    override fun onCreate() {
        super.onCreate()
        instance = this
        Log.d(TAG, "SmsGatewayService created")
        acquireWakeLock()
        createNotificationChannel()
        registerNetworkCallback()
    }

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        val notification = buildForegroundNotification()
        startForeground(NOTIFICATION_ID, notification)

        if (!GatewayApp.instance.isPaired) {
            Log.w(TAG, "Cannot start gateway: Device is not paired")
            return START_STICKY
        }

        startRealtimeListener()
        startHeartbeatLoop()
        triggerQueueDrain()

        return START_STICKY
    }

    private fun registerNetworkCallback() {
        try {
            val connectivityManager = getSystemService(Context.CONNECTIVITY_SERVICE) as ConnectivityManager
            val request = NetworkRequest.Builder()
                .addCapability(NetworkCapabilities.NET_CAPABILITY_INTERNET)
                .build()

            networkCallback = object : ConnectivityManager.NetworkCallback() {
                override fun onAvailable(network: Network) {
                    super.onAvailable(network)
                    Log.d(TAG, "Internet connection re-established, reconnecting realtime...")
                    startRealtimeListener()
                    triggerQueueDrain()
                }

                override fun onLost(network: Network) {
                    super.onLost(network)
                    Log.w(TAG, "Internet connection lost")
                }
            }
            connectivityManager.registerNetworkCallback(request, networkCallback!!)
        } catch (e: Exception) {
            Log.e(TAG, "Failed to register network callback", e)
        }
    }

    private fun startRealtimeListener() {
        SupabaseManager.subscribeToQueue(scope) {
            triggerQueueDrain()
        }
    }

    fun triggerQueueDrain() {
        if (isQueueProcessing) return
        scope.launch {
            isQueueProcessing = true
            try {
                while (isActive) {
                    val message = SupabaseManager.claimNextSms() ?: break
                    Log.d(TAG, "Claimed message ${message.messageId} for SIM ${message.simSlot}")
                    SmsDispatcher.sendSms(
                        context = applicationContext,
                        messageId = message.messageId,
                        phoneNumber = message.phoneNumber,
                        messageText = message.message,
                        simSlot = message.simSlot
                    )
                }
            } finally {
                isQueueProcessing = false
            }
        }
    }

    private fun startHeartbeatLoop() {
        scope.launch {
            var counter = 0
            while (isActive) {
                try {
                    // Periodic queue drain check
                    triggerQueueDrain()

                    // Send telemetry heartbeat every 30 seconds
                    if (counter % 3 == 0) {
                        val (battery, isCharging) = getBatteryStatus()
                        SupabaseManager.recordHeartbeat(
                            battery = battery,
                            isCharging = isCharging,
                            networkType = "WIFI/CELLULAR",
                            signalStrength = 100,
                            appVersion = "1.0.0"
                        )
                    }
                    counter++
                } catch (e: Exception) {
                    Log.e(TAG, "Heartbeat/drain loop error", e)
                }
                delay(10_000L)
            }
        }
    }

    private fun getBatteryStatus(): Pair<Int, Boolean> {
        val ifilter = IntentFilter(Intent.ACTION_BATTERY_CHANGED)
        val batteryStatus: Intent? = registerReceiver(null, ifilter)
        val level = batteryStatus?.getIntExtra(BatteryManager.EXTRA_LEVEL, -1) ?: -1
        val scale = batteryStatus?.getIntExtra(BatteryManager.EXTRA_SCALE, -1) ?: -1
        val batteryPct = if (level >= 0 && scale > 0) (level * 100 / scale) else 100

        val status = batteryStatus?.getIntExtra(BatteryManager.EXTRA_STATUS, -1) ?: -1
        val isCharging = status == BatteryManager.BATTERY_STATUS_CHARGING ||
                status == BatteryManager.BATTERY_STATUS_FULL

        return Pair(batteryPct, isCharging)
    }

    private fun acquireWakeLock() {
        val powerManager = getSystemService(Context.POWER_SERVICE) as PowerManager
        wakeLock = powerManager.newWakeLock(
            PowerManager.PARTIAL_WAKE_LOCK,
            "SmsGateway::LivenessWakeLock"
        ).apply {
            setReferenceCounted(false)
            acquire()
        }
    }

    private fun createNotificationChannel() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            val channel = NotificationChannel(
                CHANNEL_ID,
                "SMS Gateway Service",
                NotificationManager.IMPORTANCE_LOW
            ).apply {
                description = "Keeps SMS Gateway active in the background"
            }
            val manager = getSystemService(NotificationManager::class.java)
            manager.createNotificationChannel(channel)
        }
    }

    private fun buildForegroundNotification(): Notification {
        val pendingIntent = PendingIntent.getActivity(
            this,
            0,
            Intent(this, MainActivity::class.java),
            PendingIntent.FLAG_IMMUTABLE
        )

        return NotificationCompat.Builder(this, CHANNEL_ID)
            .setContentTitle(getString(R.string.service_running))
            .setContentText(getString(R.string.service_listening))
            .setSmallIcon(R.mipmap.ic_launcher)
            .setOngoing(true)
            .setContentIntent(pendingIntent)
            .build()
    }

    override fun onDestroy() {
        super.onDestroy()
        instance = null
        serviceJob.cancel()
        wakeLock?.let {
            if (it.isHeld) it.release()
        }
        try {
            networkCallback?.let {
                val cm = getSystemService(Context.CONNECTIVITY_SERVICE) as ConnectivityManager
                cm.unregisterNetworkCallback(it)
            }
        } catch (e: Exception) {
            Log.w(TAG, "Error unregistering network callback", e)
        }
        Log.d(TAG, "SmsGatewayService destroyed")
    }

    override fun onBind(intent: Intent?): IBinder? = null

    companion object {
        private const val TAG = "SmsGatewayService"
        private const val CHANNEL_ID = "sms_gateway_liveness"
        private const val NOTIFICATION_ID = 1001

        var instance: SmsGatewayService? = null
            private set

        fun start(context: Context) {
            val intent = Intent(context, SmsGatewayService::class.java)
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
                context.startForegroundService(intent)
            } else {
                context.startService(intent)
            }
        }

        fun stop(context: Context) {
            context.stopService(Intent(context, SmsGatewayService::class.java))
        }
    }
}
