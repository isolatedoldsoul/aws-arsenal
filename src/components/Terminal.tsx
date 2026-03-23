import React, { useEffect, useRef } from 'react';
import { Terminal } from 'xterm';
import { FitAddon } from '@xterm/addon-fit';
import 'xterm/css/xterm.css';
import { Socket } from 'socket.io-client';

interface TerminalProps {
  socket: Socket | null;
  sessionId: string;
  onExit?: () => void;
}

export default function TerminalComponent({ socket, sessionId, onExit }: TerminalProps) {
  const terminalRef = useRef<HTMLDivElement>(null);
  const xtermRef = useRef<Terminal | null>(null);
  const onExitRef = useRef(onExit);

  useEffect(() => {
    onExitRef.current = onExit;
  }, [onExit]);

  useEffect(() => {
    if (!terminalRef.current || !socket) return;

    const term = new Terminal({
      cursorBlink: true,
      theme: {
        background: '#0a0e14',
        foreground: '#e0d8d0',
      },
      fontFamily: 'JetBrains Mono, monospace',
      fontSize: 12,
    });
    const fitAddon = new FitAddon();
    term.loadAddon(fitAddon);
    
    term.open(terminalRef.current);
    fitAddon.fit();
    xtermRef.current = term;

    socket.emit('terminal_start', { session_id: sessionId });

    term.onData((data) => {
      socket.emit('terminal_input', { session_id: sessionId, input: data });
    });

    socket.on('terminal_output', (data) => {
      term.write(data.data);
    });

    socket.on('terminal_exit', () => {
      term.write('\r\n[Process exited]\r\n');
      if (onExitRef.current) onExitRef.current();
    });

    const handleResize = () => {
      fitAddon.fit();
    };
    window.addEventListener('resize', handleResize);

    return () => {
      window.removeEventListener('resize', handleResize);
      socket.off('terminal_output');
      socket.off('terminal_exit');
      term.dispose();
    };
  }, [socket, sessionId]);

  return <div ref={terminalRef} className="w-full h-64 rounded-xl overflow-hidden" />;
}
