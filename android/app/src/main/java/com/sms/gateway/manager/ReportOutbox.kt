package com.sms.gateway.manager

import android.util.Log
import com.sms.gateway.GatewayApp
import kotlinx.serialization.Serializable
import kotlinx.serialization.encodeToString
import kotlinx.serialization.json.Json
import java.io.File

/**
 * Persistent outbox for status reports and inbound SMS that failed to reach
 * Supabase (P9): receivers enqueue here instead of dropping the event when the
 * process dies mid-network-call. The service loop drains it with the shared
 * pacing/locking so reports survive crashes and connectivity loss.
 */
@Serializable
data class OutboxEntry(
    val kind: String, // "report" | "inbound"
    val messageId: String? = null,
    val status: String? = null,
    val errorCode: Int? = null,
    val errorMessage: String? = null,
    val sender: String? = null,
    val message: String? = null,
    val simSlot: Int? = null,
    val idemKey: String? = null,
    val createdAt: Long = System.currentTimeMillis()
)

object ReportOutbox {
    private const val TAG = "ReportOutbox"
    private const val FILE_NAME = "report_outbox.json"
    private const val MAX_ENTRIES = 500
    private val json = Json { ignoreUnknownKeys = true }
    private val lock = Any()

    private fun outFile(): File = File(GatewayApp.instance.filesDir, FILE_NAME)

    fun enqueue(entry: OutboxEntry) {
        synchronized(lock) {
            try {
                val current = readEntriesLocked()
                val updated = (current + entry).takeLast(MAX_ENTRIES)
                outFile().writeText(json.encodeToString(updated))
            } catch (e: Exception) {
                Log.e(TAG, "Failed to enqueue outbox entry", e)
            }
        }
    }

    /** Returns all pending entries and clears the file. Caller must re-enqueue on failure. */
    fun drainAll(): List<OutboxEntry> {
        synchronized(lock) {
            return try {
                val entries = readEntriesLocked()
                outFile().delete()
                entries
            } catch (e: Exception) {
                Log.e(TAG, "Failed to drain outbox", e)
                emptyList()
            }
        }
    }

    private fun readEntriesLocked(): List<OutboxEntry> {
        val file = outFile()
        if (!file.exists()) return emptyList()
        return runCatching { json.decodeFromString<List<OutboxEntry>>(file.readText()) }
            .getOrElse { emptyList() }
    }
}
