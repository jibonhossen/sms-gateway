package com.sms.gateway.ui

import android.content.ClipData
import android.content.ClipboardManager
import android.content.Context
import android.content.Intent
import android.os.Bundle
import android.view.LayoutInflater
import android.view.View
import android.view.ViewGroup
import android.widget.Toast
import androidx.appcompat.app.AlertDialog
import androidx.fragment.app.Fragment
import com.sms.gateway.GatewayApp
import com.sms.gateway.OnboardingActivity
import com.sms.gateway.R
import com.sms.gateway.databinding.FragmentSettingsBinding
import com.sms.gateway.manager.SupabaseManager
import com.sms.gateway.service.SmsGatewayService

class SettingsFragment : Fragment() {

    private var _binding: FragmentSettingsBinding? = null
    private val binding get() = _binding!!

    override fun onCreateView(
        inflater: LayoutInflater,
        container: ViewGroup?,
        savedInstanceState: Bundle?
    ): View {
        _binding = FragmentSettingsBinding.inflate(inflater, container, false)
        return binding.root
    }

    override fun onViewCreated(view: View, savedInstanceState: Bundle?) {
        super.onViewCreated(view, savedInstanceState)
        setupViews()
        setupListeners()
    }

    override fun onResume() {
        super.onResume()
        setupViews()
    }

    private fun setupViews() {
        if (_binding == null) return
        val app = GatewayApp.instance

        binding.tvSettingsSupabaseUrl.text = "Control Plane: ${app.supabaseUrl ?: "Not Configured"}"
        binding.tvSettingsOrg.text = "Organization: ${app.orgName ?: "Unpaired"}"
        binding.tvSettingsDeviceId.text = "Device ID: ${app.deviceId ?: "Unassigned"}"

        val fcmToken = app.fcmToken
        if (!fcmToken.isNullOrEmpty()) {
            binding.tvFcmToken.text = fcmToken
            binding.tvFcmStatus.text = "ACTIVE"
            binding.tvFcmStatus.setBackgroundResource(R.drawable.bg_status_pill_online)
        } else {
            binding.tvFcmToken.text = "Token generating / Waiting for Play Services..."
            binding.tvFcmStatus.text = "PENDING"
            binding.tvFcmStatus.setBackgroundResource(R.drawable.bg_badge_sim)
        }
    }

    private fun setupListeners() {
        binding.btnCopyFcmToken.setOnClickListener {
            val token = GatewayApp.instance.fcmToken
            if (!token.isNullOrEmpty()) {
                val clipboard = requireContext().getSystemService(Context.CLIPBOARD_SERVICE) as ClipboardManager
                val clip = ClipData.newPlainText("FCM Push Token", token)
                clipboard.setPrimaryClip(clip)
                Toast.makeText(requireContext(), "FCM Push Token copied to clipboard!", Toast.LENGTH_SHORT).show()
            } else {
                Toast.makeText(requireContext(), "No FCM token available yet", Toast.LENGTH_SHORT).show()
            }
        }

        binding.btnUnpair.setOnClickListener {
            AlertDialog.Builder(requireContext())
                .setTitle(R.string.unpair_device)
                .setMessage(R.string.unpair_confirmation)
                .setPositiveButton(R.string.unpair) { _, _ ->
                    performUnpair()
                }
                .setNegativeButton(R.string.cancel, null)
                .show()
        }
    }

    private fun performUnpair() {
        val context = requireContext()
        SmsGatewayService.stop(context)
        SupabaseManager.resetClient()
        GatewayApp.instance.clearAll()

        Toast.makeText(context, "Device successfully unpaired", Toast.LENGTH_SHORT).show()

        val intent = Intent(context, OnboardingActivity::class.java).apply {
            flags = Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_CLEAR_TASK
        }
        startActivity(intent)
        activity?.finish()
    }

    override fun onDestroyView() {
        super.onDestroyView()
        _binding = null
    }
}
