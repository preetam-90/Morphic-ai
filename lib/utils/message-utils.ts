import { type Message as DBMessage } from '@/lib/db/schema'
import { CoreMessage as SDKCoreMessage, UIMessage } from 'ai'

// Type definition for the CoreMessage from AI SDK
interface CoreMessage {
  role: string
  content: string | Array<{ type: string; text: string }> | null
  id?: string
  // Add other properties that might be in CoreMessage here
}

// Interface matching the expected DB message input format
interface DatabaseMessageInput {
  role: DBMessage['role']
  parts: any // Using 'any' here as we don't know the exact structure expected by the database
}

/**
 * Converts a single message from AI SDK to a database-compatible message format
 * @param message - Message from AI SDK
 * @returns Database-compatible message object
 */
export function convertMessageForDB(
  message: SDKCoreMessage
): DatabaseMessageInput {
  // Handle case where content might be a string, array, or null
  let parts: any

  if (message.content === null || message.content === undefined) {
    parts = []
  } else if (typeof message.content === 'string') {
    parts = [{ text: message.content }]
  } else if (Array.isArray(message.content)) {
    // For array content (common in assistant messages with tool calls)
    // Extract text parts and join them
    const textParts = message.content
      .filter(part => part.type === 'text')
      .map(part => ({ text: part.text }))

    if (textParts.length > 0) {
      parts = textParts
    } else {
      // If no text parts, use the first part's content or stringify the whole content
      parts = [{ text: JSON.stringify(message.content) }]
    }
  } else {
    // Fall back to JSON string for other content types
    parts = [{ text: JSON.stringify(message.content) }]
  }

  return {
    role: message.role,
    parts: parts
  }
}

/**
 * Converts an array of messages from AI SDK to database-compatible message format
 * @param messages - Array of messages from AI SDK
 * @returns Array of database-compatible message objects
 */
export function convertMessagesForDB(
  messages: SDKCoreMessage[]
): DatabaseMessageInput[] {
  return messages.map(convertMessageForDB)
}

/**
 * Extract the first text content from a message for use as a title
 * @param message - Message from AI SDK
 * @param maxLength - Maximum title length to extract
 * @returns Extracted title string, truncated to maxLength
 */
export function extractTitleFromMessage(
  message: SDKCoreMessage,
  maxLength = 100
): string {
  if (!message.content) return 'New Chat'

  if (typeof message.content === 'string') {
    return message.content.substring(0, maxLength)
  }

  // For array content, try to find text parts
  if (Array.isArray(message.content)) {
    const textPart = message.content.find(part => part.type === 'text')
    if (textPart && 'text' in textPart) {
      return textPart.text.substring(0, maxLength)
    }
  }

  return 'New Chat'
}

/**
 * Extracts and concatenates text content from a message's 'parts' array.
 *
 * This function mimics the behavior of the expression:
 * `message?.parts?.filter(part => part.type === 'text').map(part => part.text).join(' ') ?? '';`
 *
 * @param message - An object that may contain a 'parts' array. Can be undefined.
 * @returns A string of concatenated text from text parts, or an empty string
 *          if 'message' or 'message.parts' is undefined, or if 'parts' is empty or contains no text parts.
 */
export function getTextFromParts(parts?: UIMessage['parts']): string {
  return (
    parts
      ?.filter(part => part.type === 'text')
      .map(part => part.text)
      .join(' ') ?? ''
  )
}
