package com.sms.gateway.ui

import android.Manifest
import android.content.Context
import android.content.Intent
import android.content.IntentFilter
import android.content.pm.PackageManager
import android.os.BatteryManager
import android.os.Bundle
import android.telephony.SubscriptionManager
import android.util.Log
import android.view.LayoutInflater
import android.view.View
import android.view.ViewGroup
import android.widget.Toast
import androidx.core.content.ContextCompat
import androidx.fragment.app.Fragment
import com.sms.gateway.GatewayApp
import com.sms.gateway.R
import com.sms.gateway.databinding.FragmentHomeBinding
import com.sms.gateway.service.SmsGatewayService

class HomeFragment : Fragment() {

    private var _binding: FragmentHomeBinding? = null
    private val binding get() = _binding!!

    override fun onCreateView(
        inflater: LayoutInflater,
        container: ViewGroup?,
        savedInstanceState: Bundle?
    ): View {
        _binding = FragmentHomeBinding.inflate(inflater, container, false)
        return binding.root
    }

    override fun onViewCreated(view: View, savedInstanceState: Bundle?) {
        super.onViewCreated(view, savedInstanceState)
        setupListeners()
        updateUi()
    }

    override fun onResume() {
        super.onResume()
        updateUi()
    }

    private fun setupListeners() {
        binding.btnRestartService.setOnClickListener {
            val context = requireContext()
            SmsGatewayService.start(context)
            SmsGatewayService.instance?.requestDrain()
            Toast.makeText(context, "Relay Service restarted & queue checked", Toast.LENGTH_SHORT).show()
            updateUi()
        }
    }

    fun updateUi() {
        if (_binding == null) return
        val app = GatewayApp.instance

        if (app.isPaired) {
            binding.tvOrgName.text = "Organization: ${app.orgName ?: "SMS HQ Corp"}"
            binding.tvConnectionStatus.text = getString(R.string.status_connected)
            binding.tvConnectionStatus.setTextColor(ContextCompat.getColor(requireContext(), R.color.online_green))
            binding.statusPillLayout.setBackgroundResource(R.drawable.bg_status_pill_online)
            binding.statusIndicator.setBackgroundResource(R.drawable.circle_online)
            binding.tvDeviceId.text = "Device ID: ${app.deviceId}"
        } else {
            binding.tvOrgName.text = "Unpaired Device"
            binding.tvConnectionStatus.text = getString(R.string.status_unpaired)
            binding.tvConnectionStatus.setTextColor(ContextCompat.getColor(requireContext(), R.color.offline_red))
            binding.statusPillLayout.setBackgroundResource(R.drawable.bg_status_pill_offline)
            binding.statusIndicator.setBackgroundResource(R.drawable.circle_offline)
            binding.tvDeviceId.text = "Device ID: Unregistered"
        }

        updateBatteryInfo()
        updateSimInfo()
    }

    private fun updateBatteryInfo() {
        val context = context ?: return
        val batteryStatusIntent = context.registerReceiver(null, IntentFilter(Intent.ACTION_BATTERY_CHANGED))
        val level = batteryStatusIntent?.getIntExtra(BatteryManager.EXTRA_LEVEL, -1) ?: -1
        val scale = batteryStatusIntent?.getIntExtra(BatteryManager.EXTRA_SCALE, -1) ?: -1
        val status = batteryStatusIntent?.getIntExtra(BatteryManager.EXTRA_STATUS, -1) ?: -1

        val batteryPct = if (level >= 0 && scale > 0) ((level / scale.toFloat()) * 100).toInt() else 100
        val isCharging = status == BatteryManager.BATTERY_STATUS_CHARGING || status == BatteryManager.BATTERY_STATUS_FULL

        binding.tvBatteryInfo.text = "Battery: $batteryPct%${if (isCharging) " (Charging • AC)" else ""}"
        binding.pbBattery.progress = batteryPct

        if (batteryPct <= 20) {
            binding.pbBattery.setIndicatorColor(ContextCompat.getColor(context, R.color.amber_warning))
        } else {
            binding.pbBattery.setIndicatorColor(ContextCompat.getColor(context, R.color.accent))
        }
    }

    private fun updateSimInfo() {
        val context = context ?: return
        if (ContextCompat.checkSelfPermission(context, Manifest.permission.READ_PHONE_STATE) != PackageManager.PERMISSION_GRANTED) {
            binding.tvSimInfo.text = "Cellular SIM Subscriptions (Permission Required)"
            return
        }

        try {
            val subManager = context.getSystemService(Context.TELEPHONY_SUBSCRIPTION_SERVICE) as SubscriptionManager
            val subList = subManager.activeSubscriptionInfoList

            if (!subList.isNullOrEmpty()) {
                binding.tvSimInfo.text = "Cellular SIM Subscriptions (${subList.size} Active)"

                val sim1 = subList.find { it.simSlotIndex == 0 }
                if (sim1 != null) {
                    val carrier = sim1.carrierName?.toString()?.ifBlank { "Primary Line" } ?: "SIM 1"
                    binding.tvSim1Carrier.text = "SIM 1 • $carrier"
                    binding.tvSim1Status.text = "ACTIVE"
                    binding.tvSim1Status.visibility = View.VISIBLE
                } else {
                    binding.tvSim1Carrier.text = "SIM 1 • Empty Tray"
                    binding.tvSim1Status.visibility = View.GONE
                }

                val sim2 = subList.find { it.simSlotIndex == 1 }
                if (sim2 != null) {
                    val carrier = sim2.carrierName?.toString()?.ifBlank { "Secondary Line" } ?: "SIM 2"
                    binding.tvSim2Carrier.text = "SIM 2 • $carrier"
                    binding.tvSim2Status.text = "BACKUP"
                    binding.tvSim2Status.visibility = View.VISIBLE
                } else {
                    binding.tvSim2Carrier.text = "SIM 2 • Empty Tray"
                    binding.tvSim2Status.visibility = View.GONE
                }
            } else {
                binding.tvSimInfo.text = "Cellular SIM Subscriptions (No SIM Detected)"
                binding.tvSim1Carrier.text = "SIM 1 • No SIM"
                binding.tvSim1Status.visibility = View.GONE
                binding.tvSim2Carrier.text = "SIM 2 • No SIM"
                binding.tvSim2Status.visibility = View.GONE
            }
        } catch (e: Exception) {
            Log.e(TAG, "Error detecting SIM cards", e)
        }
    }

    override fun onDestroyView() {
        super.onDestroyView()
        _binding = null
    }

    companion object {
        private const val TAG = "HomeFragment"
    }
}
