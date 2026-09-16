package com.sms.gateway.ui

import android.view.LayoutInflater
import android.view.ViewGroup
import androidx.core.content.ContextCompat
import androidx.recyclerview.widget.DiffUtil
import androidx.recyclerview.widget.ListAdapter
import androidx.recyclerview.widget.RecyclerView
import com.sms.gateway.R
import com.sms.gateway.databinding.ItemLogEntryBinding
import com.sms.gateway.model.ActivityLog

class LogAdapter(
    private val onItemClick: ((ActivityLog) -> Unit)? = null
) : ListAdapter<ActivityLog, LogAdapter.LogViewHolder>(LogDiffCallback()) {

    override fun onCreateViewHolder(parent: ViewGroup, viewType: Int): LogViewHolder {
        val binding = ItemLogEntryBinding.inflate(
            LayoutInflater.from(parent.context),
            parent,
            false
        )
        return LogViewHolder(binding, onItemClick)
    }

    override fun onBindViewHolder(holder: LogViewHolder, position: Int) {
        holder.bind(getItem(position))
    }

    class LogViewHolder(
        private val binding: ItemLogEntryBinding,
        private val onItemClick: ((ActivityLog) -> Unit)?
    ) : RecyclerView.ViewHolder(binding.root) {

        fun bind(item: ActivityLog) {
            val context = binding.root.context
            binding.tvLogPhone.text = item.phoneNumber
            binding.tvLogMessage.text = item.message
            binding.tvLogTime.text = item.formattedTime
            binding.tvLogSimSlot.text = "SIM ${item.simSlot + 1} (Slot ${item.simSlot})"

            binding.tvLogStatus.text = item.status.uppercase()

            when (item.status.uppercase()) {
                "DELIVERED" -> {
                    binding.tvLogStatus.setBackgroundResource(R.drawable.bg_status_pill_online)
                    binding.tvLogStatus.setTextColor(ContextCompat.getColor(context, R.color.online_green))
                }
                "SENT" -> {
                    binding.tvLogStatus.setBackgroundResource(R.drawable.bg_status_pill_online)
                    binding.tvLogStatus.setTextColor(ContextCompat.getColor(context, R.color.primary))
                }
                "FAILED" -> {
                    binding.tvLogStatus.setBackgroundResource(R.drawable.bg_status_pill_offline)
                    binding.tvLogStatus.setTextColor(ContextCompat.getColor(context, R.color.offline_red))
                }
                "INBOUND" -> {
                    binding.tvLogStatus.setBackgroundResource(R.drawable.bg_badge_sim)
                    binding.tvLogStatus.setTextColor(ContextCompat.getColor(context, R.color.accent))
                }
                else -> {
                    binding.tvLogStatus.setBackgroundResource(R.drawable.bg_badge_sim)
                    binding.tvLogStatus.setTextColor(ContextCompat.getColor(context, R.color.text_secondary))
                }
            }

            binding.root.setOnClickListener {
                onItemClick?.invoke(item)
            }
        }
    }

    class LogDiffCallback : DiffUtil.ItemCallback<ActivityLog>() {
        override fun areItemsTheSame(oldItem: ActivityLog, newItem: ActivityLog): Boolean =
            oldItem.id == newItem.id

        override fun areContentsTheSame(oldItem: ActivityLog, newItem: ActivityLog): Boolean =
            oldItem == newItem
    }
}
