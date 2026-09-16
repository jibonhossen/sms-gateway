package com.sms.gateway.ui

import android.os.Bundle
import android.view.LayoutInflater
import android.view.View
import android.view.ViewGroup
import androidx.fragment.app.Fragment
import androidx.lifecycle.lifecycleScope
import androidx.recyclerview.widget.LinearLayoutManager
import android.content.ClipData
import android.content.ClipboardManager
import android.content.Context
import android.widget.Toast
import androidx.appcompat.app.AlertDialog
import com.google.android.material.dialog.MaterialAlertDialogBuilder
import com.sms.gateway.R
import com.sms.gateway.databinding.DialogSmsDetailsBinding
import com.sms.gateway.databinding.FragmentLogsBinding
import com.sms.gateway.model.ActivityLog
import com.sms.gateway.model.ActivityLogManager
import kotlinx.coroutines.flow.collectLatest
import kotlinx.coroutines.launch

class LogsFragment : Fragment() {

    private var _binding: FragmentLogsBinding? = null
    private val binding get() = _binding!!
    private val adapter = LogAdapter { log ->
        showLogDetailsDialog(log)
    }

    override fun onCreateView(
        inflater: LayoutInflater,
        container: ViewGroup?,
        savedInstanceState: Bundle?
    ): View {
        _binding = FragmentLogsBinding.inflate(inflater, container, false)
        return binding.root
    }

    override fun onViewCreated(view: View, savedInstanceState: Bundle?) {
        super.onViewCreated(view, savedInstanceState)

        binding.rvLogs.layoutManager = LinearLayoutManager(requireContext())
        binding.rvLogs.adapter = adapter

        viewLifecycleOwner.lifecycleScope.launch {
            ActivityLogManager.logs.collectLatest { list ->
                adapter.submitList(list)
                if (list.isEmpty()) {
                    binding.emptyLogsView.visibility = View.VISIBLE
                    binding.rvLogs.visibility = View.GONE
                } else {
                    binding.emptyLogsView.visibility = View.GONE
                    binding.rvLogs.visibility = View.VISIBLE
                }
            }
        }
    }

    private fun showLogDetailsDialog(log: ActivityLog) {
        val dialogBinding = DialogSmsDetailsBinding.inflate(layoutInflater)
        
        dialogBinding.tvDetailPhone.text = log.phoneNumber
        dialogBinding.tvDetailTime.text = log.formattedTime
        dialogBinding.tvDetailSim.text = "SIM ${log.simSlot + 1} (Slot ${log.simSlot})"
        dialogBinding.tvDetailStatus.text = log.status.uppercase()
        dialogBinding.tvDetailMessage.text = log.message

        when (log.status.uppercase()) {
            "DELIVERED" -> {
                dialogBinding.tvDetailStatus.setBackgroundResource(R.drawable.bg_status_pill_online)
                dialogBinding.tvDetailStatus.setTextColor(requireContext().getColor(R.color.online_green))
            }
            "SENT" -> {
                dialogBinding.tvDetailStatus.setBackgroundResource(R.drawable.bg_status_pill_online)
                dialogBinding.tvDetailStatus.setTextColor(requireContext().getColor(R.color.primary))
            }
            "FAILED" -> {
                dialogBinding.tvDetailStatus.setBackgroundResource(R.drawable.bg_status_pill_offline)
                dialogBinding.tvDetailStatus.setTextColor(requireContext().getColor(R.color.offline_red))
            }
            "INBOUND" -> {
                dialogBinding.tvDetailStatus.setBackgroundResource(R.drawable.bg_badge_sim)
                dialogBinding.tvDetailStatus.setTextColor(requireContext().getColor(R.color.accent))
            }
            else -> {
                dialogBinding.tvDetailStatus.setBackgroundResource(R.drawable.bg_badge_sim)
                dialogBinding.tvDetailStatus.setTextColor(requireContext().getColor(R.color.text_secondary))
            }
        }

        val dialog = MaterialAlertDialogBuilder(requireContext())
            .setView(dialogBinding.root)
            .create()

        dialogBinding.btnCopyText.setOnClickListener {
            val clipboard = requireContext().getSystemService(Context.CLIPBOARD_SERVICE) as ClipboardManager
            val clip = ClipData.newPlainText("SMS Message", log.message)
            clipboard.setPrimaryClip(clip)
            Toast.makeText(requireContext(), "Message copied to clipboard", Toast.LENGTH_SHORT).show()
        }

        dialogBinding.btnCloseDialog.setOnClickListener {
            dialog.dismiss()
        }

        dialog.window?.setBackgroundDrawableResource(android.R.color.transparent)
        dialog.show()
    }

    override fun onDestroyView() {
        super.onDestroyView()
        _binding = null
    }
}
