export function HyzrMark({ size = 24, className = "" }: { size?: number; className?: string }) {
  return (
    <span
      className={`hyzr-mark ${className}`.trim()}
      style={{ width: size, height: size }}
      aria-hidden="true"
    >
      <img src="/hyzr-chat-mark.svg?v=4" alt="" draggable={false} />
    </span>
  );
}

export function HyzrChatLogo({ compact = false }: { compact?: boolean }) {
  return (
    <span className="hyzr-chat-logo" aria-label="Hyzr Chat">
      <HyzrMark />
      {!compact && <span className="hyzr-chat-wordmark"><b>Hyzr</b><em>Chat</em></span>}
    </span>
  );
}
