package com.sms.gateway

import android.Manifest
import android.content.Context
import android.content.Intent
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
            Toast.makeText(this, "SMS permissions are required for gateway function", Toast.LENGTH_LONG).show()
        }
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
        binding.btnPair.setOnClickListener {
            val options = ScanOptions().apply {
                setPrompt("Scan Dashboard QR Code to Pair")
                setBeepEnabled(true)
                setOrientationLocked(true)
                setCaptureActivity(QrScanActivity::class.java)
            }
            scanQrLauncher.launch(options)
        }

        binding.btnToggleService.setOnClickListener {
            if (!GatewayApp.instance.isPaired) {
                Toast.makeText(this, "Please pair device first", Toast.LENGTH_SHORT).show()
                return@setOnClickListener
            }
            SmsGatewayService.start(this)
            updateUi()
        }
    }

    private fun handleQrScanned(jsonStr: String) {
        Log.d("MainActivity", "handleQrScanned called with: $jsonStr")
        lifecycleScope.launch {
            try {
                val payload = Json.decodeFromString<QrPairingPayload>(jsonStr)
                Log.d("MainActivity", "Decoded payload: code=${payload.pairingCode}, url=${payload.url}")
                val deviceName = "${Build.MANUFACTURER} ${Build.MODEL}"
                val rawSecret = UUID.randomUUID().toString()

                // Generate SHA-256 hash for authentication
                val md = MessageDigest.getInstance("SHA-256")
                val hashBytes = md.digest(rawSecret.toByteArray())
                val hashHex = hashBytes.joinToString("") { "%02x".format(it) }

                val pairingResult = SupabaseManager.completePairing(
                    url = payload.url,
                    anonKey = payload.anonKey,
                    pairingCode = payload.pairingCode,
                    deviceName = deviceName,
                    deviceTokenHash = hashHex,
                    androidVer = Build.VERSION.RELEASE,
                    appVer = "1.0.0"
                )

                if (pairingResult != null) {
                    Log.d("MainActivity", "Pairing successful! Device ID: ${pairingResult.deviceId}")
                    GatewayApp.instance.supabaseUrl = payload.url
                    GatewayApp.instance.supabaseAnonKey = payload.anonKey
                    GatewayApp.instance.deviceId = pairingResult.deviceId
                    GatewayApp.instance.orgId = pairingResult.organizationId
                    GatewayApp.instance.orgName = pairingResult.orgName

                    SupabaseManager.resetClient()
                    SmsGatewayService.start(this@MainActivity)

                    Toast.makeText(this@MainActivity, "Paired with ${pairingResult.orgName}!", Toast.LENGTH_SHORT).show()
                    updateUi()
                } else {
                    Log.e("MainActivity", "Pairing returned null - session might be invalid or expired")
                    Toast.makeText(this@MainActivity, "Pairing failed. QR code may be expired.", Toast.LENGTH_LONG).show()
                }
            } catch (e: Exception) {
                Log.e("MainActivity", "Error handling pairing data", e)
                Toast.makeText(this@MainActivity, "Invalid QR code: ${e.message}", Toast.LENGTH_SHORT).show()
            }
        }
    }

    private fun updateUi() {
        val app = GatewayApp.instance
        if (app.isPaired) {
            binding.tvOrgName.text = "Organization: ${app.orgName ?: "Active"}"
            binding.tvConnectionStatus.text = getString(R.string.status_connected)
            binding.statusIndicator.setBackgroundResource(R.drawable.circle_online)
            binding.btnToggleService.text = "Restart Relay Service"
            binding.tvDeviceId.text = "Device ID: ${app.deviceId}"
        } else {
            binding.tvOrgName.text = "Unpaired Device"
            binding.tvConnectionStatus.text = getString(R.string.status_unpaired)
            binding.statusIndicator.setBackgroundResource(R.drawable.circle_offline)
            binding.btnToggleService.text = getString(R.string.start_service)
            binding.tvDeviceId.text = "Device ID: Unregistered"
        }

        // Telemetry info
        val batteryManager = getSystemService(Context.BATTERY_SERVICE) as BatteryManager
        val batteryLevel = batteryManager.getIntProperty(BatteryManager.BATTERY_PROPERTY_CAPACITY)
        binding.tvBatteryInfo.text = "Battery: $batteryLevel%"

        // SIM slots
        binding.tvSimInfo.text = detectSimCards()
    }

    private fun detectSimCards(): String {
        return try {
            val subManager = getSystemService(Context.TELEPHONY_SUBSCRIPTION_SERVICE) as SubscriptionManager
            val count = subManager.activeSubscriptionInfoCount
            if (count > 0) "$count Active SIM Card(s) detected" else "No active SIM card"
        } catch (e: SecurityException) {
            "SIM permission required"
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
}
