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
import android.telephony.TelephonyManager
import android.util.Log
import androidx.core.app.NotificationCompat
import com.sms.gateway.BuildConfig
import com.sms.gateway.GatewayApp
import com.sms.gateway.MainActivity
import com.sms.gateway.R
import com.sms.gateway.manager.ReceiptAggregator
import com.sms.gateway.manager.SmsDispatcher
import com.sms.gateway.manager.SupabaseManager
import com.sms.gateway.model.ActivityLogManager
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.cancel
import kotlinx.coroutines.channels.Channel
import kotlinx.coroutines.delay
import kotlinx.coroutines.isActive
import kotlinx.coroutines.launch
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock

class SmsGatewayService : Service() {
    private val serviceJob = SupervisorJob()
    private val scope = CoroutineScope(Dispatchers.IO + serviceJob)

    private var wakeLock: PowerManager.WakeLock? = null
    private val drainSignal = Channel<Unit>(Channel.CONFLATED)
    private val drainMutex = Mutex()
    @Volatile private var drainLoopStarted = false
    @Volatile private var drainActive = false
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

        startDrainLoop()
        startHeartbeatLoop()
        // Idempotent single-channel realtime subscription (C3, P3)
        SupabaseManager.subscribeToQueue(scope) { requestDrain() }
        requestDrain()

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
                    Log.d(TAG, "Internet connection re-established, draining queue...")
                    // Realtime auto-reconnects on its own; we only need to drain.
                    requestDrain()
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

    /**
     * Single drain actor (H4): FCM wake-ups, network callbacks, realtime
     * events and the heartbeat all funnel through one conflated channel, and
     * exactly one consumer drains behind a mutex. The old race-prone
     * `isQueueProcessing` flag is gone.
     */
    fun requestDrain() {
        scope.launch { drainSignal.trySend(Unit) }
    }

    private fun startDrainLoop() {
        if (drainLoopStarted) return
        drainLoopStarted = true
        scope.launch {
            for (signal in drainSignal) {
                drainMutex.withLock {
                    drainActive = true
                    try {
                        drainQueue()
                    } finally {
                        drainActive = false
                    }
                }
            }
        }
    }

    private suspend fun CoroutineScope.drainQueue() {
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
        // Retry any receipts/inbound inserts that previously failed (P9)
        SupabaseManager.drainReportOutbox()
    }

    private fun startHeartbeatLoop() {
        scope.launch {
            var counter = 0
            while (isActive) {
                try {
                    requestDrain()

                    if (counter % 3 == 0) {
                        // Real telemetry + lease renewal while draining (C4, P2)
                        val (battery, isCharging) = getBatteryStatus()
                        SupabaseManager.recordHeartbeat(
                            battery = battery,
                            isCharging = isCharging,
                            networkType = resolveNetworkType(),
                            signalStrength = resolveSignalStrength(),
                            appVersion = BuildConfig.VERSION_NAME,
                            activeDrain = drainActive
                        )

                        // Fail messages whose part-receipts never completed (H1)
                        for ((messageId, receipt) in ReceiptAggregator.sweepTimeouts()) {
                            ActivityLogManager.updateStatus(messageId, "FAILED", receipt.errorMessage)
                            SupabaseManager.reportSmsResultReliable(
                                messageId = messageId,
                                status = "failed",
                                errorCode = receipt.errorCode,
                                errorMessage = receipt.errorMessage
                            )
                        }

                        // Re-acquire the bounded wakelock (P11)
                        if (wakeLock?.isHeld != true) acquireWakeLock()
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

    // Real telemetry instead of hardcoded placeholders (P2)
    private fun resolveNetworkType(): String {
        return try {
            val cm = getSystemService(ConnectivityManager::class.java)
            val caps = cm?.getNetworkCapabilities(cm.activeNetwork)
            when {
                caps == null -> "UNKNOWN"
                caps.hasTransport(NetworkCapabilities.TRANSPORT_WIFI) -> "WIFI"
                caps.hasTransport(NetworkCapabilities.TRANSPORT_CELLULAR) -> "CELLULAR"
                else -> "OTHER"
            }
        } catch (e: Exception) {
            "UNKNOWN"
        }
    }

    private fun resolveSignalStrength(): Int {
        return try {
            val tm = getSystemService(TelephonyManager::class.java)
            val strength = tm?.signalStrength ?: return 0
            strength.level * 25 // 0..4 levels -> 0..100%
        } catch (e: Exception) {
            0
        }
    }

    // Bounded wakelock with periodic re-acquire (P11) instead of an indefinite hold
    private fun acquireWakeLock() {
        val powerManager = getSystemService(Context.POWER_SERVICE) as PowerManager
        wakeLock = powerManager.newWakeLock(
            PowerManager.PARTIAL_WAKE_LOCK,
            "SmsGateway::LivenessWakeLock"
        ).apply {
            setReferenceCounted(false)
            acquire(WAKELOCK_TIMEOUT_MS)
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
        private const val WAKELOCK_TIMEOUT_MS = 10 * 60 * 1000L

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

