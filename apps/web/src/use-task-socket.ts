import { useEffect, useRef, useState } from "react";
import type { TaskEvent, TaskRequest } from "@marksweep/core/protocol";

export function useTaskSocket(onEvent: (event: TaskEvent) => void, onDisconnect: () => void) {
  const socket = useRef<WebSocket | null>(null);
  const eventHandler = useRef(onEvent);
  const disconnectHandler = useRef(onDisconnect);
  const [connected, setConnected] = useState(false);
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    eventHandler.current = onEvent;
    disconnectHandler.current = onDisconnect;
  });
  useEffect(() => {
    const connection = new WebSocket(`${location.protocol === "https:" ? "wss" : "ws"}://${location.host}/ws`);
    socket.current = connection;
    let disposed = false;
    connection.onopen = () => {
      if (!disposed) setConnected(true);
    };
    connection.onmessage = (message) => {
      if (disposed) return;
      try {
        eventHandler.current(JSON.parse(String(message.data)) as TaskEvent);
      } catch {
        disconnectHandler.current();
        connection.close();
      }
    };
    connection.onclose = () => {
      if (disposed) return;
      setConnected(false);
      disconnectHandler.current();
    };
    return () => {
      disposed = true;
      connection.close();
    };
  }, [attempt]);
  return {
    connected,
    reconnect: () => {
      setConnected(false);
      setAttempt((value) => value + 1);
    },
    send: (request: TaskRequest) => {
      if (socket.current?.readyState !== WebSocket.OPEN) throw new Error("本地服务未连接，请重新连接。");
      socket.current.send(JSON.stringify(request));
    },
    cancel: (requestId: string) => socket.current?.send(JSON.stringify({ type: "cancel", requestId })),
  };
}
