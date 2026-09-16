package com.sms.gateway.manager

import android.telephony.SmsManager
import java.util.concurrent.ConcurrentHashMap

/**
 * Aggregates per-part SENT broadcasts of (multi-part) SMS messages into a
 * single terminal receipt (H1). Every part of a multipart message fires its
 * own broadcast; only when ALL parts resolved do we report one terminal
 * result to Supabase — preventing the re-queue of half-delivered messages.
 */
data class TerminalReceipt(
    val success: Boolean,
    val errorCode: Int?,
    val errorMessage: String?
)

object ReceiptAggregator {
    private const val TIMEOUT_MS = 60_000L

    private class Tracker(val partCount: Int, val createdAt: Long) {
        val sentOk = arrayOfNulls<Boolean>(partCount)
        var firstErrorCode: Int? = null
        var firstErrorMessage: String? = null
        var resolved = false
    }

    private val trackers = ConcurrentHashMap<String, Tracker>()

    /**
     * Records one part's SENT broadcast result.
     * Returns a TerminalReceipt when the whole message reached a terminal
     * state, or null while parts are still pending.
     */
    fun recordSentPart(
        messageId: String,
        partIndex: Int,
        partCount: Int,
        resultCode: Int
    ): TerminalReceipt? {
        val tracker = trackers.computeIfAbsent(messageId) {
            Tracker(partCount.coerceAtLeast(1), System.currentTimeMillis())
        }
        synchronized(tracker) {
            if (tracker.resolved) return null

            if (resultCode == android.app.Activity.RESULT_OK) {
                tracker.sentOk[partIndex.coerceIn(0, tracker.partCount - 1)] = true
                if (tracker.sentOk.all { it == true }) {
                    tracker.resolved = true
                    trackers.remove(messageId)
                    return TerminalReceipt(true, null, null)
                }
            } else {
                // Any part failure = whole message failed (H1: never re-send
                // parts that were already delivered)
                tracker.resolved = true
                trackers.remove(messageId)
                return TerminalReceipt(
                    false,
                    resultCode,
                    describeError(resultCode)
                )
            }
            return null
        }
    }

    /**
     * Fails messages whose receipts never completed (receiver died, broadcast
     * lost). Called periodically by the service loop.
     */
    fun sweepTimeouts(): List<Pair<String, TerminalReceipt>> {
        val now = System.currentTimeMillis()
        val timedOut = mutableListOf<Pair<String, TerminalReceipt>>()
        for ((id, tracker) in trackers) {
            synchronized(tracker) {
                if (!tracker.resolved && now - tracker.createdAt > TIMEOUT_MS) {
                    tracker.resolved = true
                    timedOut.add(
                        id to TerminalReceipt(
                            false,
                            SmsManager.RESULT_ERROR_GENERIC_FAILURE,
                            "Receipt timeout: part confirmations missing"
                        )
                    )
                }
            }
            if (tracker.resolved) trackers.remove(id)
        }
        return timedOut
    }

    fun describeError(resultCode: Int): String = when (resultCode) {
        SmsManager.RESULT_ERROR_NO_SERVICE -> "No cellular reception"
        SmsManager.RESULT_ERROR_RADIO_OFF -> "Radio off / Airplane mode active"
        5 -> "Android OS SMS rate limit exceeded" // RESULT_ERROR_LIMIT_EXCEEDED
        SmsManager.RESULT_ERROR_NULL_PDU -> "Null PDU received from carrier"
        else -> "Carrier rejection (error code $resultCode)"
    }
}
