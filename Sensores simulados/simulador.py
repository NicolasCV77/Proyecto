"""
simulador.py — Simulador de sensores ParamoSense
Envía datos MQTT al tópico paramosense/data con sensores virtuales SIM_XX
"""

import tkinter as tk
from tkinter import ttk, scrolledtext
import threading
import random
import time
import json
from datetime import datetime

try:
    import paho.mqtt.client as mqtt
    from paho.mqtt.client import CallbackAPIVersion
    MQTT_V2 = True
except (ImportError, AttributeError):
    try:
        import paho.mqtt.client as mqtt
        MQTT_V2 = False
    except ImportError:
        print("ERROR: instala paho-mqtt → pip install paho-mqtt")
        exit(1)

# ─── Config MQTT ───────────────────────────────────────────────────────────────
BROKER = "broker.hivemq.com"
PORT   = 1883
TOPIC  = "paramosense/data"

# ─── Rangos de datos (alineados con categorías de clima del dashboard) ────────
#   Óptimo:     temp 5-15 °C | hum >70% | agua 60-95% | suelo >60%
#   Intermedio: temp 15-20 °C ó 3-5 °C | hum 40-70% | agua 40-60% | suelo 30-60%
#   Crítico:    temp >20 °C ó <3 °C | hum <40% | agua <40% ó >90% | suelo <30%
OPTIMO = {
    "temperature": (5.0,  15.0),
    "humidity":    (70.0, 90.0),
    "water":       (60.0, 95.0),
    "soil":        (60.0, 80.0),
}
INTERMEDIO = {
    "temperature": [(15.1, 19.9), (3.1, 4.9)],
    "humidity":    [(40.0, 69.9)],
    "water":       [(40.0, 59.9)],
    "soil":        [(30.0, 59.9)],
}
CRITICO = {
    "temperature": [(0.0, 2.5), (22.0, 30.0)],
    "humidity":    [(15.0, 38.0)],
    "water":       [(5.0, 35.0), (92.0, 99.0)],
    "soil":        [(5.0, 25.0)],
}

MODES_ORDER = ["optimo", "intermedio", "critico"]

# ─── Colores ───────────────────────────────────────────────────────────────────
C_BG      = "#0f172a"
C_SURFACE = "#1e293b"
C_BORDER  = "#334155"
C_PRIMARY = "#0d9488"
C_ACCENT  = "#14b8a6"
C_TEXT    = "#e2e8f0"
C_MUTED   = "#94a3b8"
C_CRIT    = "#ef4444"
C_WARN    = "#f59e0b"
C_OK      = "#22c55e"
C_BTN_DEL = "#7f1d1d"


def _rand_single(spec, key):
    """spec puede ser (lo, hi) o [(lo, hi), ...]"""
    val = spec[key]
    if isinstance(val[0], (int, float)):
        lo, hi = val
    else:
        lo, hi = random.choice(val)
    return round(random.uniform(lo, hi), 1)


def make_payload(node_id, mode):
    spec = {"optimo": OPTIMO, "intermedio": INTERMEDIO}.get(mode, CRITICO)
    return {
        "nodeId":      node_id,
        "temperature": _rand_single(spec, "temperature"),
        "humidity":    _rand_single(spec, "humidity"),
        "water":       _rand_single(spec, "water"),
        "soil":        _rand_single(spec, "soil"),
    }


# ─── Cliente MQTT compartido ───────────────────────────────────────────────────
class MQTTManager:
    def __init__(self, on_log):
        self.on_log    = on_log
        self.connected = False
        self._lock     = threading.Lock()
        self._client   = None
        self._connect()

    def _connect(self):
        try:
            if MQTT_V2:
                self._client = mqtt.Client(CallbackAPIVersion.VERSION1,
                                           client_id="paramosense-sim",
                                           clean_session=True)
            else:
                self._client = mqtt.Client(client_id="paramosense-sim",
                                           clean_session=True)

            self._client.on_connect    = self._on_connect
            self._client.on_disconnect = self._on_disconnect
            self._client.connect_async(BROKER, PORT, keepalive=60)
            self._client.loop_start()
        except Exception as e:
            self.on_log(f"[MQTT] Error de conexión: {e}", "error")

    def _on_connect(self, client, userdata, flags, rc):
        if rc == 0:
            self.connected = True
            self.on_log(f"[MQTT] Conectado a {BROKER}:{PORT}", "info")
        else:
            self.on_log(f"[MQTT] Fallo de conexión (rc={rc})", "error")

    def _on_disconnect(self, client, userdata, rc):
        self.connected = False
        self.on_log("[MQTT] Desconectado del broker", "warn")

    def publish(self, payload: dict) -> bool:
        with self._lock:
            if not self.connected or self._client is None:
                return False
            try:
                self._client.publish(TOPIC, json.dumps(payload), qos=0)
                return True
            except Exception:
                return False

    def stop(self):
        if self._client:
            self._client.loop_stop()
            self._client.disconnect()


# ─── Sensor virtual ────────────────────────────────────────────────────────────
class VirtualSensor:
    def __init__(self, node_id, mqtt_mgr, on_log, on_status_change):
        self.node_id          = node_id
        self.mode             = "optimo"
        self.interval         = 5
        self.running          = False
        self._mqtt            = mqtt_mgr
        self._on_log          = on_log
        self._on_status       = on_status_change
        self._stop_event      = threading.Event()
        self._thread: threading.Thread | None = None

    def _loop(self):
        while not self._stop_event.is_set():
            payload = make_payload(self.node_id, self.mode)
            ok      = self._mqtt.publish(payload)
            tag     = "sent" if ok else "error"
            msg     = (f"[{datetime.now().strftime('%H:%M:%S')}] "
                       f"{self.node_id} → {json.dumps(payload)}")
            self._on_log(msg, tag)
            self._stop_event.wait(self.interval)

    def start(self):
        if self.running:
            return
        self.running = True
        self._stop_event.clear()
        self._thread = threading.Thread(target=self._loop, daemon=True)
        self._thread.start()
        self._on_status(self.node_id)

    def stop(self):
        if not self.running:
            return
        self.running = False
        self._stop_event.set()
        self._on_status(self.node_id)

    def set_mode(self, mode):
        self.mode = mode
        self._on_status(self.node_id)

    def set_interval(self, interval):
        self.interval = int(interval)


# ─── GUI ───────────────────────────────────────────────────────────────────────
class SimuladorApp(tk.Tk):
    def __init__(self):
        super().__init__()
        self.title("ParamoSense — Simulador de sensores")
        self.configure(bg=C_BG)
        self.geometry("960x620")
        self.minsize(780, 480)
        self.resizable(True, True)

        self._sensors: dict[str, VirtualSensor]    = {}
        self._rows:    dict[str, dict]             = {}
        self._counter  = 0

        self._build_ui()
        self._mqtt = MQTTManager(self._log)

        # pasar sensores el mqtt manager cuando esté listo
        self._check_mqtt_ready()
        self.protocol("WM_DELETE_WINDOW", self._on_close)

    # ── construir UI ────────────────────────────────────────────────────────────
    def _build_ui(self):
        # Header
        hdr = tk.Frame(self, bg=C_SURFACE, pady=10)
        hdr.pack(fill="x")
        tk.Label(hdr, text="⬡  ParamoSense", bg=C_SURFACE, fg=C_ACCENT,
                 font=("Segoe UI", 15, "bold")).pack(side="left", padx=16)
        tk.Label(hdr, text="Simulador de sensores MQTT", bg=C_SURFACE,
                 fg=C_MUTED, font=("Segoe UI", 10)).pack(side="left", padx=4)

        # Body
        body = tk.Frame(self, bg=C_BG)
        body.pack(fill="both", expand=True, padx=12, pady=10)

        # Panel izquierdo
        left = tk.Frame(body, bg=C_BG, width=440)
        left.pack(side="left", fill="both", expand=False, padx=(0, 8))
        left.pack_propagate(False)

        # Controles globales
        ctrl = tk.Frame(left, bg=C_SURFACE, padx=10, pady=8)
        ctrl.pack(fill="x", pady=(0, 8))

        tk.Button(ctrl, text="+ Agregar sensor", bg=C_PRIMARY, fg="white",
                  font=("Segoe UI", 9, "bold"), relief="flat", cursor="hand2",
                  padx=10, pady=4,
                  command=self._add_sensor).pack(side="left", padx=(0, 6))

        tk.Button(ctrl, text="▶ Iniciar todos", bg=C_SURFACE, fg=C_OK,
                  font=("Segoe UI", 9), relief="flat", cursor="hand2",
                  bd=1, highlightbackground=C_BORDER, padx=8, pady=4,
                  command=self._start_all).pack(side="left", padx=2)

        tk.Button(ctrl, text="■ Detener todos", bg=C_SURFACE, fg=C_CRIT,
                  font=("Segoe UI", 9), relief="flat", cursor="hand2",
                  bd=1, highlightbackground=C_BORDER, padx=8, pady=4,
                  command=self._stop_all).pack(side="left", padx=2)

        # Lista de sensores (scroll)
        list_frame = tk.Frame(left, bg=C_SURFACE)
        list_frame.pack(fill="both", expand=True)

        tk.Label(list_frame, text="Sensores virtuales", bg=C_SURFACE,
                 fg=C_MUTED, font=("Segoe UI", 8)).pack(anchor="w", padx=10, pady=(6, 2))

        canvas = tk.Canvas(list_frame, bg=C_SURFACE, highlightthickness=0)
        scrollbar = ttk.Scrollbar(list_frame, orient="vertical",
                                  command=canvas.yview)
        self._sensor_list = tk.Frame(canvas, bg=C_SURFACE)

        self._sensor_list.bind("<Configure>",
            lambda e: canvas.configure(scrollregion=canvas.bbox("all")))
        canvas.create_window((0, 0), window=self._sensor_list, anchor="nw")
        canvas.configure(yscrollcommand=scrollbar.set)

        canvas.pack(side="left", fill="both", expand=True)
        scrollbar.pack(side="right", fill="y")

        # Mensaje vacío
        self._empty_label = tk.Label(self._sensor_list,
                                     text="Sin sensores. Haz clic en '+ Agregar sensor'.",
                                     bg=C_SURFACE, fg=C_MUTED,
                                     font=("Segoe UI", 9), wraplength=280)
        self._empty_label.pack(pady=20)

        # Panel derecho — log
        right = tk.Frame(body, bg=C_BG)
        right.pack(side="right", fill="both", expand=True)

        log_hdr = tk.Frame(right, bg=C_SURFACE, padx=10, pady=6)
        log_hdr.pack(fill="x")
        tk.Label(log_hdr, text="Log de mensajes", bg=C_SURFACE, fg=C_TEXT,
                 font=("Segoe UI", 9, "bold")).pack(side="left")
        tk.Button(log_hdr, text="Limpiar", bg=C_SURFACE, fg=C_MUTED,
                  font=("Segoe UI", 8), relief="flat", cursor="hand2",
                  command=self._clear_log).pack(side="right")

        self._log_box = scrolledtext.ScrolledText(
            right, bg="#0a0f1e", fg=C_TEXT,
            font=("Consolas", 8), relief="flat",
            state="disabled", wrap="word"
        )
        self._log_box.pack(fill="both", expand=True)

        # tags de color
        self._log_box.tag_config("info",  foreground=C_ACCENT)
        self._log_box.tag_config("sent",  foreground="#86efac")
        self._log_box.tag_config("error", foreground=C_CRIT)
        self._log_box.tag_config("warn",  foreground=C_WARN)

        # Status bar
        self._status_var = tk.StringVar(value="Conectando a broker MQTT...")
        tk.Label(self, textvariable=self._status_var, bg=C_BORDER,
                 fg=C_MUTED, font=("Segoe UI", 8),
                 anchor="w", padx=10).pack(fill="x", side="bottom")

    # ── helpers UI ──────────────────────────────────────────────────────────────
    def _check_mqtt_ready(self):
        if hasattr(self, '_mqtt') and self._mqtt.connected:
            self._status_var.set(f"Conectado a {BROKER}:{PORT}  |  Tópico: {TOPIC}")
        else:
            self.after(500, self._check_mqtt_ready)

    def _log(self, msg: str, tag: str = "info"):
        def _do():
            self._log_box.configure(state="normal")
            self._log_box.insert("end", msg + "\n", tag)
            self._log_box.configure(state="disabled")
            self._log_box.see("end")
        self.after(0, _do)

    def _clear_log(self):
        self._log_box.configure(state="normal")
        self._log_box.delete("1.0", "end")
        self._log_box.configure(state="disabled")

    def _update_status(self, node_id):
        if node_id not in self._sensors:
            return
        s   = self._sensors[node_id]
        row = self._rows[node_id]

        dot_color = C_OK if s.running else C_BORDER
        row["dot"].configure(bg=dot_color)

        if s.running:
            row["btn_toggle"].configure(text="■ Detener", fg=C_CRIT)
        else:
            row["btn_toggle"].configure(text="▶ Iniciar", fg=C_OK)

        if s.mode == "critico":
            row["btn_mode"].configure(text="⚠ Crítico",     fg=C_CRIT, bg="#450a0a")
        elif s.mode == "intermedio":
            row["btn_mode"].configure(text="⚡ Intermedio",  fg=C_WARN, bg="#3d2a00")
        else:
            row["btn_mode"].configure(text="✓ Óptimo",       fg=C_OK,   bg="#052e16")

    # ── gestión sensores ────────────────────────────────────────────────────────
    def _next_id(self):
        self._counter += 1
        return f"SIM_{self._counter:02d}"

    def _add_sensor(self):
        node_id = self._next_id()

        if not self._sensors:
            self._empty_label.pack_forget()

        # fila contenedor
        frame = tk.Frame(self._sensor_list, bg=C_BG,
                         highlightbackground=C_BORDER, highlightthickness=1)
        frame.pack(fill="x", padx=6, pady=3, ipady=4)

        inner = tk.Frame(frame, bg=C_BG)
        inner.pack(fill="x", padx=8)

        # dot estado
        dot = tk.Label(inner, bg=C_BORDER, width=2, text="")
        dot.pack(side="left", padx=(0, 6))

        # nombre
        tk.Label(inner, text=node_id, bg=C_BG, fg=C_TEXT,
                 font=("Consolas", 9, "bold"), width=8).pack(side="left")

        # botón modo
        btn_mode = tk.Button(inner, text="✓ Óptimo", bg="#052e16", fg=C_OK,
                             font=("Segoe UI", 8), relief="flat", cursor="hand2",
                             padx=6, pady=2)
        btn_mode.pack(side="left", padx=4)

        # intervalo
        interval_var = tk.StringVar(value="5")
        interval_cb  = ttk.Combobox(inner, textvariable=interval_var,
                                    values=["3","5","10","15","30","60"],
                                    width=4, state="readonly")
        interval_cb.pack(side="left", padx=4)
        tk.Label(inner, text="s", bg=C_BG, fg=C_MUTED,
                 font=("Segoe UI", 8)).pack(side="left")

        # botón toggle
        btn_toggle = tk.Button(inner, text="▶ Iniciar", fg=C_OK,
                               bg=C_SURFACE, font=("Segoe UI", 8),
                               relief="flat", cursor="hand2", padx=6, pady=2)
        btn_toggle.pack(side="left", padx=4)

        # botón borrar
        btn_del = tk.Button(inner, text="✕", fg=C_CRIT, bg=C_BTN_DEL,
                            font=("Segoe UI", 8, "bold"), relief="flat",
                            cursor="hand2", padx=6, pady=2)
        btn_del.pack(side="right")

        # crear sensor
        sensor = VirtualSensor(node_id, self._mqtt,
                               self._log, self._update_status)
        self._sensors[node_id] = sensor
        self._rows[node_id] = {
            "frame":      frame,
            "dot":        dot,
            "btn_mode":   btn_mode,
            "btn_toggle": btn_toggle,
            "interval_v": interval_var,
        }

        # bind botones
        btn_toggle.configure(command=lambda n=node_id: self._toggle(n))
        btn_mode.configure(  command=lambda n=node_id: self._toggle_mode(n))
        btn_del.configure(   command=lambda n=node_id: self._remove(n))
        interval_cb.bind("<<ComboboxSelected>>",
                         lambda e, n=node_id: self._change_interval(n))

        self._log(f"[SIM] Sensor {node_id} creado", "info")

    def _toggle(self, node_id):
        s = self._sensors.get(node_id)
        if not s:
            return
        if s.running:
            s.stop()
        else:
            s.start()

    def _toggle_mode(self, node_id):
        s = self._sensors.get(node_id)
        if not s:
            return
        idx      = MODES_ORDER.index(s.mode) if s.mode in MODES_ORDER else 0
        new_mode = MODES_ORDER[(idx + 1) % len(MODES_ORDER)]
        s.set_mode(new_mode)
        labels = {"optimo": "óptimo", "intermedio": "intermedio", "critico": "crítico"}
        tags   = {"optimo": "info",   "intermedio": "warn",       "critico": "error"}
        self._log(f"[SIM] {node_id} → modo {labels[new_mode]}", tags[new_mode])

    def _change_interval(self, node_id):
        s   = self._sensors.get(node_id)
        row = self._rows.get(node_id)
        if not s or not row:
            return
        val = row["interval_v"].get()
        s.set_interval(val)
        self._log(f"[SIM] {node_id} → intervalo {val}s", "info")

    def _remove(self, node_id):
        s = self._sensors.pop(node_id, None)
        if s:
            s.stop()
        row = self._rows.pop(node_id, None)
        if row:
            row["frame"].destroy()
        self._log(f"[SIM] Sensor {node_id} eliminado", "warn")
        if not self._sensors:
            self._empty_label.pack(pady=20)

    def _start_all(self):
        for s in self._sensors.values():
            s.start()

    def _stop_all(self):
        for s in self._sensors.values():
            s.stop()

    def _on_close(self):
        self._stop_all()
        if hasattr(self, '_mqtt'):
            self._mqtt.stop()
        self.destroy()


# ─── Entry point ──────────────────────────────────────────────────────────────
if __name__ == "__main__":
    app = SimuladorApp()
    app.mainloop()
