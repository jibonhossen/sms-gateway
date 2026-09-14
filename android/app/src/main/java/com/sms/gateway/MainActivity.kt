package com.sms.gateway

import android.Manifest
import android.content.Context
import android.content.Intent
import android.content.IntentFilter
import android.content.pm.PackageManager
import android.net.Uri
import android.os.BatteryManager
import android.os.Build
import android.os.Bundle
import android.os.PowerManager
import android.provider.Settings
import android.telephony.SubscriptionManager
import android.util.Log
import android.widget.Toast
import androidx.activity.result.contract.ActivityResultContracts
import androidx.appcompat.app.AppCompatActivity
import androidx.core.content.ContextCompat
import androidx.lifecycle.lifecycleScope
import com.journeyapps.barcodescanner.ScanContract
import com.journeyapps.barcodescanner.ScanOptions
import com.sms.gateway.databinding.ActivityMainBinding
import com.sms.gateway.manager.SupabaseManager
import com.sms.gateway.model.QrPairingPayload
import com.sms.gateway.service.SmsGatewayService
import kotlinx.coroutines.launch
import kotlinx.serialization.json.Json
import java.security.MessageDigest
import java.util.UUID

class MainActivity : AppCompatActivity() {
    private lateinit var binding: ActivityMainBinding

    private val requestPermissionLauncher = registerForActivityResult(
        ActivityResultContracts.RequestMultiplePermissions()
    ) { permissions ->
        val allGranted = permissions.entries.all { it.value }
        if (!allGranted) {
            Toast.makeText(this, "Permissions are required for cellular gateway function", Toast.LENGTH_LONG).show()
        }
        updateSimInfo()
    }

    private val scanQrLauncher = registerForActivityResult(ScanContract()) { result ->
        if (result.contents != null) {
            handleQrScanned(result.contents)
        }
    }

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        binding = ActivityMainBinding.inflate(layoutInflater)
        setContentView(binding.root)

        requestRequiredPermissions()
        requestBatteryExemption()
        setupListeners()
        updateUi()
        checkPairingIntent(intent)

        if (GatewayApp.instance.isPaired) {
            SmsGatewayService.start(this)
        }
    }

    override fun onNewIntent(intent: Intent) {
        super.onNewIntent(intent)
        checkPairingIntent(intent)
    }

    private fun checkPairingIntent(intent: Intent?) {
        var pairingData = intent?.getStringExtra("pairing_data")
        if (!pairingData.isNullOrBlank()) {
            if (pairingData.startsWith("b64:")) {
                pairingData = String(android.util.Base64.decode(pairingData.removePrefix("b64:"), android.util.Base64.DEFAULT))
            }
            handleQrScanned(pairingData)
        }
    }

    override fun onResume() {
        super.onResume()
        updateUi()
    }

    private fun setupListeners() {
        // QR Scanner Button
        binding.btnPair.setOnClickListener {
            val options = ScanOptions().apply {
                setPrompt("Scan Dashboard QR Code to Pair")
                setBeepEnabled(true)
                setOrientationLocked(true)
                setCaptureActivity(QrScanActivity::class.java)
            }
            scanQrLauncher.launch(options)
        }

        // Manual Pairing Code Button
        binding.btnPairWithCode.setOnClickListener {
            val rawCode = binding.etPairingCode.text?.toString()?.trim() ?: ""
            if (rawCode.isEmpty()) {
                binding.tilPairingCode.error = "Please enter 6-digit code"
                return@setOnClickListener
            }
            binding.tilPairingCode.error = null

            val cleanedCode = rawCode.replace("-", "").replace(" ", "").trim()
            val url = GatewayApp.instance.supabaseUrl ?: BuildConfig.DEFAULT_SUPABASE_URL
            val anonKey = GatewayApp.instance.supabaseAnonKey ?: BuildConfig.DEFAULT_SUPABASE_ANON_KEY

            binding.btnPairWithCode.isEnabled = false
            binding.btnPairWithCode.text = "Pairing…"

            performPairing(url, anonKey, cleanedCode) { success ->
                binding.btnPairWithCode.isEnabled = true
                binding.btnPairWithCode.text = getString(R.string.pair_with_code)
                if (success) {
                    binding.etPairingCode.text?.clear()
                }
            }
        }

        // Service Toggle / Restart
        binding.btnToggleService.setOnClickListener {
            if (!GatewayApp.instance.isPaired) {
                Toast.makeText(this, "Please pair device first", Toast.LENGTH_SHORT).show()
                return@setOnClickListener
            }
            SmsGatewayService.start(this)
            Toast.makeText(this, "Relay Service restarted", Toast.LENGTH_SHORT).show()
            updateUi()
        }
    }

    private fun handleQrScanned(jsonStr: String) {
        Log.d(TAG, "handleQrScanned called with: $jsonStr")
        try {
            val payload = Json.decodeFromString<QrPairingPayload>(jsonStr)
            Log.d(TAG, "Decoded payload: code=${payload.pairingCode}, url=${payload.url}")
            performPairing(payload.url, payload.anonKey, payload.pairingCode)
        } catch (e: Exception) {
            Log.e(TAG, "Error parsing QR payload", e)
            Toast.makeText(this, "Invalid QR code: ${e.message}", Toast.LENGTH_SHORT).show()
        }
    }

    private fun performPairing(
        url: String,
        anonKey: String,
        pairingCode: String,
        onComplete: ((Boolean) -> Unit)? = null
    ) {
        lifecycleScope.launch {
            try {
                val deviceName = "${Build.MANUFACTURER} ${Build.MODEL}"
                val rawSecret = UUID.randomUUID().toString()

                val md = MessageDigest.getInstance("SHA-256")
                val hashBytes = md.digest(rawSecret.toByteArray())
                val hashHex = hashBytes.joinToString("") { "%02x".format(it) }

                val pairingResult = SupabaseManager.completePairing(
                    url = url,
                    anonKey = anonKey,
                    pairingCode = pairingCode,
                    deviceName = deviceName,
                    deviceTokenHash = hashHex,
                    androidVer = Build.VERSION.RELEASE,
                    appVer = "1.0.0"
                )

                if (pairingResult != null) {
                    Log.d(TAG, "Pairing successful! Device ID: ${pairingResult.deviceId}")
                    GatewayApp.instance.supabaseUrl = url
                    GatewayApp.instance.supabaseAnonKey = anonKey
                    GatewayApp.instance.deviceId = pairingResult.deviceId
                    GatewayApp.instance.orgId = pairingResult.organizationId
                    GatewayApp.instance.orgName = pairingResult.orgName

                    SupabaseManager.resetClient()
                    SmsGatewayService.start(this@MainActivity)

                    Toast.makeText(this@MainActivity, "Paired with ${pairingResult.orgName}!", Toast.LENGTH_SHORT).show()
                    updateUi()
                    onComplete?.invoke(true)
                } else {
                    Log.e(TAG, "Pairing returned null - code may be expired or invalid")
                    Toast.makeText(this@MainActivity, "Pairing failed. Code may be expired or invalid.", Toast.LENGTH_LONG).show()
                    onComplete?.invoke(false)
                }
            } catch (e: Exception) {
                Log.e(TAG, "Exception during pairing", e)
                Toast.makeText(this@MainActivity, "Pairing error: ${e.message}", Toast.LENGTH_SHORT).show()
                onComplete?.invoke(false)
            }
        }
    }

    private fun updateUi() {
        val app = GatewayApp.instance
        if (app.isPaired) {
            binding.tvOrgName.text = "Organization: ${app.orgName ?: "SMS HQ Corp"}"
            binding.tvConnectionStatus.text = getString(R.string.status_connected)
            binding.tvConnectionStatus.setTextColor(ContextCompat.getColor(this, R.color.online_green))
            binding.statusPillLayout.setBackgroundResource(R.drawable.bg_status_pill_online)
            binding.statusIndicator.setBackgroundResource(R.drawable.circle_online)
            binding.btnToggleService.text = getString(R.string.restart_service)
            binding.tvDeviceId.text = "Device ID: ${app.deviceId}"
        } else {
            binding.tvOrgName.text = "Unpaired Device"
            binding.tvConnectionStatus.text = getString(R.string.status_unpaired)
            binding.tvConnectionStatus.setTextColor(ContextCompat.getColor(this, R.color.offline_red))
            binding.statusPillLayout.setBackgroundResource(R.drawable.bg_status_pill_offline)
            binding.statusIndicator.setBackgroundResource(R.drawable.circle_offline)
            binding.btnToggleService.text = getString(R.string.start_service)
            binding.tvDeviceId.text = "Device ID: Unregistered"
        }

        updateBatteryInfo()
        updateSimInfo()
    }

    private fun updateBatteryInfo() {
        val batteryStatusIntent = registerReceiver(null, IntentFilter(Intent.ACTION_BATTERY_CHANGED))
        val level = batteryStatusIntent?.getIntExtra(BatteryManager.EXTRA_LEVEL, -1) ?: -1
        val scale = batteryStatusIntent?.getIntExtra(BatteryManager.EXTRA_SCALE, -1) ?: -1
        val status = batteryStatusIntent?.getIntExtra(BatteryManager.EXTRA_STATUS, -1) ?: -1

        val batteryPct = if (level >= 0 && scale > 0) ((level / scale.toFloat()) * 100).toInt() else 100
        val isCharging = status == BatteryManager.BATTERY_STATUS_CHARGING || status == BatteryManager.BATTERY_STATUS_FULL

        binding.tvBatteryInfo.text = "Battery: $batteryPct%${if (isCharging) " (Charging • AC)" else ""}"
        binding.pbBattery.progress = batteryPct

        if (batteryPct <= 20) {
            binding.pbBattery.setIndicatorColor(ContextCompat.getColor(this, R.color.amber_warning))
        } else {
            binding.pbBattery.setIndicatorColor(ContextCompat.getColor(this, R.color.accent))
        }
    }

    private fun updateSimInfo() {
        if (ContextCompat.checkSelfPermission(this, Manifest.permission.READ_PHONE_STATE) != PackageManager.PERMISSION_GRANTED) {
            binding.tvSimInfo.text = "Cellular SIM Subscriptions (Permission Required)"
            return
        }

        try {
            val subManager = getSystemService(Context.TELEPHONY_SUBSCRIPTION_SERVICE) as SubscriptionManager
            val subList = subManager.activeSubscriptionInfoList

            if (!subList.isNullOrEmpty()) {
                binding.tvSimInfo.text = "Cellular SIM Subscriptions (${subList.size} Active)"

                val sim1 = subList.find { it.simSlotIndex == 0 }
                if (sim1 != null) {
                    val carrier = sim1.carrierName?.toString()?.ifBlank { "Airtel" } ?: "Airtel BD"
                    binding.tvSim1Carrier.text = "SIM 1 • $carrier"
                    binding.tvSim1Status.text = "ACTIVE (DEFAULT)"
                    binding.tvSim1Status.visibility = android.view.View.VISIBLE
                } else {
                    binding.tvSim1Carrier.text = "SIM 1 • Empty"
                    binding.tvSim1Status.visibility = android.view.View.GONE
                }

                val sim2 = subList.find { it.simSlotIndex == 1 }
                if (sim2 != null) {
                    val carrier = sim2.carrierName?.toString()?.ifBlank { "Banglalink" } ?: "Banglalink"
                    binding.tvSim2Carrier.text = "SIM 2 • $carrier"
                    binding.tvSim2Status.text = "BACKUP"
                    binding.tvSim2Status.visibility = android.view.View.VISIBLE
                } else {
                    binding.tvSim2Carrier.text = "SIM 2 • Empty"
                    binding.tvSim2Status.visibility = android.view.View.GONE
                }
            } else {
                binding.tvSimInfo.text = "Cellular SIM Subscriptions (No SIM Detected)"
                binding.tvSim1Carrier.text = "SIM 1 • No SIM"
                binding.tvSim1Status.visibility = android.view.View.GONE
                binding.tvSim2Carrier.text = "SIM 2 • No SIM"
                binding.tvSim2Status.visibility = android.view.View.GONE
            }
        } catch (e: Exception) {
            Log.e(TAG, "Error detecting SIM cards", e)
        }
    }

    private fun requestRequiredPermissions() {
        val permissions = arrayOf(
            Manifest.permission.SEND_SMS,
            Manifest.permission.RECEIVE_SMS,
            Manifest.permission.READ_PHONE_STATE,
            Manifest.permission.CAMERA
        )
        val missing = permissions.filter {
            ContextCompat.checkSelfPermission(this, it) != PackageManager.PERMISSION_GRANTED
        }
        if (missing.isNotEmpty()) {
            requestPermissionLauncher.launch(missing.toTypedArray())
        }
    }

    private fun requestBatteryExemption() {
        val powerManager = getSystemService(Context.POWER_SERVICE) as PowerManager
        if (!powerManager.isIgnoringBatteryOptimizations(packageName)) {
            val intent = Intent(Settings.ACTION_REQUEST_IGNORE_BATTERY_OPTIMIZATIONS).apply {
                data = Uri.parse("package:$packageName")
            }
            startActivity(intent)
        }
    }

    companion object {
        private const val TAG = "MainActivity"
    }
}
