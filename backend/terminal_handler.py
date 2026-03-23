import os
import asyncio
import ptyprocess
import threading

class TerminalHandler:
    def __init__(self, session_id, sid, sio, sso_session_name: str = ""):
        self.session_id = session_id
        self.sid = sid
        self.sio = sio
        self.sso_session_name = sso_session_name
        self.process = None
        self._running = False

    async def start(self):
        home_dir = f"/tmp/sessions/{self.session_id}"
        env = os.environ.copy()
        env["HOME"] = home_dir

        cmd = ["aws", "sso", "login"]
        if self.sso_session_name:
            cmd += ["--sso-session", self.sso_session_name]

        self.process = ptyprocess.PtyProcess.spawn(cmd, env=env)
        self._running = True
        
        loop = asyncio.get_event_loop()
        threading.Thread(target=self._read_thread, args=(loop,), daemon=True).start()

    def _read_thread(self, loop):
        while self._running:
            try:
                data = self.process.read(1024)
                if not data:
                    break
                
                if isinstance(data, bytes):
                    text = data.decode('utf-8', errors='replace')
                else:
                    text = data

                asyncio.run_coroutine_threadsafe(
                    self.sio.emit('terminal_output', {'data': text}, to=self.sid),
                    loop
                )
            except EOFError:
                break
            except Exception as e:
                print(f"Terminal read error: {e}")
                break
        
        self._running = False
        asyncio.run_coroutine_threadsafe(
            self.sio.emit('terminal_exit', {}, to=self.sid),
            loop
        )

    async def write(self, data: str):
        if self.process and self._running:
            try:
                # ptyprocess write takes bytes if using PtyProcess, str if PtyProcessUnicode
                # We'll try bytes first, then str
                try:
                    self.process.write(data.encode('utf-8'))
                except TypeError:
                    self.process.write(data)
            except Exception as e:
                print(f"Terminal write error: {e}")

    def close(self):
        self._running = False
        if self.process:
            try:
                self.process.terminate(force=True)
            except:
                pass

