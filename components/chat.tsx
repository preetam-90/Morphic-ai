'use client'

import { useEffect, useMemo, useRef, useState } from 'react'

import { useChat } from '@ai-sdk/react'
import { DefaultChatTransport } from 'ai'
import { toast } from 'sonner'
import { z } from 'zod'

import { generateId } from '@/lib/db/schema'
import { UploadedFile } from '@/lib/types'
import type { UIDataTypes, UIMessage, UITools } from '@/lib/types/ai'
import { Model } from '@/lib/types/models'
import { cn } from '@/lib/utils'

import { useFileDropzone } from '@/hooks/use-file-dropzone'

import { ChatMessages } from './chat-messages'
import { ChatPanel } from './chat-panel'
import { DragOverlay } from './drag-overlay'

// Define section structure
interface ChatSection {
  id: string // User message ID
  userMessage: UIMessage
  assistantMessages: UIMessage[]
}

export function Chat({
  id,
  savedMessages = [],
  query,
  models
}: {
  id: string
  savedMessages?: UIMessage[]
  query?: string
  models?: Model[]
}) {
  const scrollContainerRef = useRef<HTMLDivElement>(null)
  const [isAtBottom, setIsAtBottom] = useState(true)
  const [uploadedFiles, setUploadedFiles] = useState<UploadedFile[]>([])
  const [input, setInput] = useState('')

  const {
    messages,
    status,
    setMessages,
    stop,
    sendMessage,
    regenerate,
    addToolResult
  } = useChat({
    id, // use the provided chatId
    transport: new DefaultChatTransport({
      api: '/api/chat',
      prepareSendMessagesRequest: ({ messages, trigger, messageId }) => {
        switch (trigger) {
          case 'regenerate-assistant-message':
            // Find the message being regenerated
            const messageToRegenerate = messages.find(m => m.id === messageId)
            return {
              body: {
                trigger: 'regenerate-assistant-message',
                chatId: id,
                messageId,
                // Include the message if it's a user message (for edit cases)
                message: messageToRegenerate?.role === 'user' ? messageToRegenerate : undefined
              }
            }

          case 'submit-user-message':
          default:
            // Only send the last message
            return {
              body: {
                trigger: 'submit-user-message',
                chatId: id,
                message: messages[messages.length - 1],
                messageId
              }
            }
        }
      }
    }),
    messages: savedMessages,
    onFinish: () => {
      window.dispatchEvent(new CustomEvent('chat-history-updated'))
    },
    onError: error => {
      toast.error(`Error in chat: ${error.message}`)
    },
    experimental_throttle: 100,
    generateId
  })

  const handleInputChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    setInput(e.target.value)
  }

  // Convert messages array to sections array
  const sections = useMemo<ChatSection[]>(() => {
    const result: ChatSection[] = []
    let currentSection: ChatSection | null = null

    for (const message of messages) {
      if (message.role === 'user') {
        // Start a new section when a user message is found
        if (currentSection) {
          result.push(currentSection)
        }
        currentSection = {
          id: message.id,
          userMessage: message,
          assistantMessages: []
        }
      } else if (currentSection && message.role === 'assistant') {
        // Add assistant message to the current section
        currentSection.assistantMessages.push(message)
      }
      // Ignore other role types like 'system' for now
    }

    // Add the last section if exists
    if (currentSection) {
      result.push(currentSection)
    }

    return result
  }, [messages])

  // Detect if scroll container is at the bottom
  useEffect(() => {
    const container = scrollContainerRef.current
    if (!container) return

    const handleScroll = () => {
      const { scrollTop, scrollHeight, clientHeight } = container
      const threshold = 50 // threshold in pixels
      if (scrollHeight - scrollTop - clientHeight < threshold) {
        setIsAtBottom(true)
      } else {
        setIsAtBottom(false)
      }
    }

    container.addEventListener('scroll', handleScroll, { passive: true })
    handleScroll() // Set initial state

    return () => container.removeEventListener('scroll', handleScroll)
  }, [])

  // Scroll to the section when a new user message is sent
  useEffect(() => {
    if (sections.length > 0) {
      const lastMessage = messages[messages.length - 1]
      if (lastMessage && lastMessage.role === 'user') {
        // If the last message is from user, find the corresponding section
        const sectionId = lastMessage.id
        requestAnimationFrame(() => {
          const sectionElement = document.getElementById(`section-${sectionId}`)
          sectionElement?.scrollIntoView({ behavior: 'smooth', block: 'start' })
        })
      }
    }
  }, [sections, messages])

  const onQuerySelect = (query: string) => {
    sendMessage({
      role: 'user',
      parts: [{ type: 'text', text: query }]
    })
  }

  const handleUpdateAndReloadMessage = async (
    editedMessageId: string,
    newContentText: string
  ) => {
    if (!id) {
      toast.error('Chat ID is missing.')
      console.error(
        'handleUpdateAndReloadMessage: chatId (id prop) is undefined.'
      )
      return
    }

    try {
      // Update the message locally with the same ID
      setMessages(prevMessages => {
        const messageIndex = prevMessages.findIndex(
          m => m.id === editedMessageId
        )
        if (messageIndex === -1) return prevMessages

        const updatedMessages = [...prevMessages]
        updatedMessages[messageIndex] = {
          ...updatedMessages[messageIndex],
          parts: [{ type: 'text', text: newContentText }]
        }

        return updatedMessages
      })

      // Regenerate from this message
      await regenerate({ messageId: editedMessageId })
    } catch (error) {
      console.error('Error during message edit and reload process:', error)
      toast.error(
        `Error processing edited message: ${(error as Error).message}`
      )
    }
  }

  const handleReloadFrom = async (reloadFromFollowerMessageId: string) => {
    if (!id) {
      toast.error('Chat ID is missing for reload.')
      return
    }

    try {
      // Use the SDK's regenerate function with the specific messageId
      await regenerate({ messageId: reloadFromFollowerMessageId })
    } catch (error) {
      console.error(
        `Error during reload from message ${reloadFromFollowerMessageId}:`,
        error
      )
      toast.error(`Failed to reload conversation: ${(error as Error).message}`)
    }
  }

  const onSubmit = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault()

    const uploaded = uploadedFiles.filter(f => f.status === 'uploaded')

    if (input.trim() || uploaded.length > 0) {
      const parts: any[] = []

      if (input.trim()) {
        parts.push({ type: 'text', text: input })
      }

      uploaded.forEach(f => {
        parts.push({
          type: 'file',
          url: f.url!,
          name: f.name!,
          key: f.key!,
          mediaType: f.file.type
        })
      })

      sendMessage({ role: 'user', parts })
      setInput('')
      setUploadedFiles([])

      // Push URL state immediately after sending message (for new chats)
      // Check if we're on the root path (new chat)
      if (window.location.pathname === '/') {
        window.history.pushState({}, '', `/search/${id}`)
      }
    }
  }

  const { isDragging, handleDragOver, handleDragLeave, handleDrop } =
    useFileDropzone({
      uploadedFiles,
      setUploadedFiles,
      chatId: id
    })

  return (
    <div
      className={cn(
        'relative flex h-full min-w-0 flex-1 flex-col',
        messages.length === 0 ? 'items-center justify-center' : ''
      )}
      data-testid="full-chat"
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
    >
      <ChatMessages
        sections={sections}
        onQuerySelect={onQuerySelect}
        status={status}
        chatId={id}
        addToolResult={({
          toolCallId,
          result
        }: {
          toolCallId: string
          result: any
        }) => {
          addToolResult({ toolCallId, output: result })
        }}
        scrollContainerRef={scrollContainerRef}
        onUpdateMessage={handleUpdateAndReloadMessage}
        reload={handleReloadFrom}
      />
      <ChatPanel
        chatId={id}
        input={input}
        handleInputChange={handleInputChange}
        handleSubmit={onSubmit}
        status={status}
        messages={messages}
        setMessages={setMessages}
        stop={stop}
        query={query}
        append={(message: any) => {
          sendMessage(message)
        }}
        models={models}
        showScrollToBottomButton={!isAtBottom}
        uploadedFiles={uploadedFiles}
        setUploadedFiles={setUploadedFiles}
        scrollContainerRef={scrollContainerRef}
      />
      <DragOverlay visible={isDragging} />
    </div>
  )
}
