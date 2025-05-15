'use client'

import { deleteTrailingMessages } from '@/lib/actions/chat-db'
import { CHAT_ID } from '@/lib/constants'
import { Model } from '@/lib/types/models'
import { cn, generateUUID } from '@/lib/utils'
import { useChat } from '@ai-sdk/react'
import { Message } from 'ai/react'
import { useEffect, useMemo, useRef, useState } from 'react'
import { toast } from 'sonner'
import { ChatMessages } from './chat-messages'
import { ChatPanel } from './chat-panel'

// Define section structure
interface ChatSection {
  id: string // User message ID
  userMessage: Message
  assistantMessages: Message[]
}

export function Chat({
  id,
  savedMessages = [],
  query,
  models
}: {
  id: string
  savedMessages?: Message[]
  query?: string
  models?: Model[]
}) {
  const scrollContainerRef = useRef<HTMLDivElement>(null)
  const [isAtBottom, setIsAtBottom] = useState(true)

  const {
    messages,
    input,
    handleInputChange,
    handleSubmit,
    status,
    setMessages,
    stop,
    append,
    data,
    setData,
    addToolResult,
    reload
  } = useChat({
    initialMessages: savedMessages,
    id: CHAT_ID,
    onFinish: () => {
      window.history.replaceState({}, '', `/search/${id}`)
      window.dispatchEvent(new CustomEvent('chat-history-updated'))
    },
    onError: error => {
      toast.error(`Error in chat: ${error.message}`)
    },
    sendExtraMessageFields: false,
    experimental_throttle: 100,
    generateId: generateUUID,
    experimental_prepareRequestBody: body => ({
      id,
      message: body.messages.at(-1)
    })
  })

  const isLoading = status === 'submitted' || status === 'streaming'

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
  }, [scrollContainerRef.current])

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

  useEffect(() => {
    setMessages(savedMessages)
  }, [id])

  const onQuerySelect = (query: string) => {
    append({
      role: 'user',
      content: query
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

    const pivotMessage = messages.find(m => m.id === editedMessageId)
    if (!pivotMessage) {
      toast.error('Original message not found to edit locally.')
      console.error(
        'handleUpdateAndReloadMessage: Pivot message not found for timestamp.'
      )
      return
    }
    const pivotTimestamp =
      pivotMessage.createdAt?.toISOString() ?? new Date(0).toISOString()

    try {
      setMessages(prevMessages => {
        const messageIndex = prevMessages.findIndex(
          m => m.id === editedMessageId
        )
        const messagesBeforeEdited =
          messageIndex !== -1
            ? prevMessages.slice(0, messageIndex)
            : prevMessages

        const newUIMessage: Message = {
          id: generateUUID(),
          role: 'user',
          content: newContentText,
          parts: [{ type: 'text', text: newContentText }],
          createdAt: new Date()
        }

        return [...messagesBeforeEdited, newUIMessage]
      })

      await deleteTrailingMessages(id, pivotTimestamp)
      await reload()
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

    const followerMessageIndex = messages.findIndex(
      m => m.id === reloadFromFollowerMessageId
    )

    if (followerMessageIndex < 1) {
      toast.error(
        'Cannot reload: No preceding message found or message is the first.'
      )
      console.error(
        `handleReloadFrom: No message found before id ${reloadFromFollowerMessageId} or it is the first message.`
      )
      return
    }

    const targetUserMessageIndex = followerMessageIndex - 1
    const targetUserMessage = messages[targetUserMessageIndex]

    if (targetUserMessage.role !== 'user') {
      toast.error(
        'Cannot reload: The message to resend must be a user message.'
      )
      console.error(
        `handleReloadFrom: Preceding message (id: ${targetUserMessage.id}) is not a user message.`
      )
      return
    }

    const followerMessage = messages[followerMessageIndex]
    const deletionTimestamp =
      followerMessage.createdAt?.toISOString() ?? new Date(0).toISOString()

    const contentToResend =
      targetUserMessage.parts
        ?.filter(p => p.type === 'text')
        .map(p => p.text)
        .join('') ||
      targetUserMessage.content ||
      ''

    try {
      setMessages(prevMessages => {
        const messagesBeforeTarget = prevMessages.slice(
          0,
          targetUserMessageIndex
        )

        const newResentUserMessage: Message = {
          id: generateUUID(),
          role: 'user',
          content: contentToResend,
          parts: [{ type: 'text', text: contentToResend }],
          createdAt: new Date()
        }
        return [...messagesBeforeTarget, newResentUserMessage]
      })

      await deleteTrailingMessages(id, deletionTimestamp)
      await reload()
    } catch (error) {
      console.error(
        `Error during reload from message preceding ${reloadFromFollowerMessageId}:`,
        error
      )
      toast.error(`Failed to reload conversation: ${(error as Error).message}`)
    }
  }

  const onSubmit = (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault()
    setData(undefined)
    handleSubmit(e)
  }

  return (
    <div
      className={cn(
        'relative flex h-full min-w-0 flex-1 flex-col',
        messages.length === 0 ? 'items-center justify-center' : ''
      )}
      data-testid="full-chat"
    >
      <ChatMessages
        sections={sections}
        data={data}
        onQuerySelect={onQuerySelect}
        isLoading={isLoading}
        chatId={id}
        addToolResult={addToolResult}
        scrollContainerRef={scrollContainerRef}
        onUpdateMessage={handleUpdateAndReloadMessage}
        reload={handleReloadFrom}
      />
      <ChatPanel
        input={input}
        handleInputChange={handleInputChange}
        handleSubmit={onSubmit}
        isLoading={isLoading}
        messages={messages}
        setMessages={setMessages}
        stop={stop}
        query={query}
        append={append}
        models={models}
        showScrollToBottomButton={!isAtBottom}
        scrollContainerRef={scrollContainerRef}
      />
    </div>
  )
}
