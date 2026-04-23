#!/bin/bash

# ============================================================
#  Dev-Helper — Background startup script
#  Runs the Angular frontend and FastAPI backend as completely
#  independent background processes (terminal is freed).
#
#  Logs  →  logs/frontend.log  |  logs/backend.log
#  PIDs  →  logs/frontend.pid  |  logs/backend.pid
#
#  To stop services run:  ./stop.sh
# ============================================================

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
FRONTEND_DIR="$ROOT_DIR"
BACKEND_DIR="$ROOT_DIR/python-ai"
LOGS_DIR="$ROOT_DIR/logs"

# ---------- Colours ----------
GREEN='\033[0;32m'
CYAN='\033[0;36m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
NC='\033[0m'

echo ""
echo -e "${CYAN}╔══════════════════════════════════════════════╗${NC}"
echo -e "${CYAN}║        🚀  Dev-Helper Startup Script         ║${NC}"
echo -e "${CYAN}╚══════════════════════════════════════════════╝${NC}"
echo ""

# ---------- Create logs directory ----------
mkdir -p "$LOGS_DIR"

# ---------- Prerequisite checks ----------
command -v node    >/dev/null 2>&1 || { echo -e "${RED}✖ node is not installed. Aborting.${NC}"; exit 1; }
command -v npm     >/dev/null 2>&1 || { echo -e "${RED}✖ npm is not installed. Aborting.${NC}";  exit 1; }
command -v python3 >/dev/null 2>&1 || command -v python >/dev/null 2>&1 \
  || { echo -e "${RED}✖ python is not installed. Aborting.${NC}"; exit 1; }

if command -v uvicorn >/dev/null 2>&1; then
  UVICORN="uvicorn"
else
  echo -e "${YELLOW}⚠  uvicorn not found globally — falling back to 'python -m uvicorn'${NC}"
  UVICORN="python -m uvicorn"
fi

# ---------- Check if services are already running ----------
check_already_running() {
  local name=$1
  local port=$2
  local pidfile="$LOGS_DIR/${name}.pid"
  
  # 1. Check PID file
  if [ -f "$pidfile" ]; then
    local pid
    pid=$(cat "$pidfile")
    if kill -0 "$pid" 2>/dev/null; then
      echo -e "${YELLOW}⚠  $name is already running (PID $pid). Stop it first with ./stop.sh${NC}"
      return 1
    else
      echo -e "   Stale PID file found for $name — cleaning up."
      rm -f "$pidfile"
    fi
  fi

  # 2. Check if port is in use
  if [ -n "$port" ]; then
    if netstat -ano | grep ":$port " | grep "LISTENING" >/dev/null 2>&1; then
      echo -e "${RED}✖  Port $port is already in use. $name might be running independently.${NC}"
      echo -e "   Please stop it or run ${CYAN}./stop.sh${NC} to clean up."
      return 1
    fi
  fi

  return 0
}

check_already_running "frontend" 4201 || exit 1
check_already_running "backend"  8000 || exit 1

# ---------- Install frontend dependencies if needed ----------
echo -e "${YELLOW}[1/3] Checking frontend dependencies...${NC}"
if [ ! -d "$FRONTEND_DIR/node_modules" ]; then
  echo -e "      node_modules not found — running ${CYAN}npm install${NC}"
  cd "$FRONTEND_DIR" && npm install
else
  echo -e "      ${GREEN}node_modules already present. Skipping npm install.${NC}"
fi

# ---------- Install backend dependencies if needed ----------
echo ""
echo -e "${YELLOW}[2/3] Checking backend dependencies...${NC}"
cd "$BACKEND_DIR"
if python3 -c "import fastapi, uvicorn" 2>/dev/null || python -c "import fastapi, uvicorn" 2>/dev/null; then
  echo -e "      ${GREEN}Python packages already installed. Skipping pip install.${NC}"
else
  echo -e "      Installing Python packages from ${CYAN}requirements.txt${NC}"
  pip install -r requirements.txt
fi

# ---------- Launch both services in the background ----------
echo ""
echo -e "${YELLOW}[3/3] Launching services in background...${NC}"
echo ""

# --- Frontend ---
cd "$FRONTEND_DIR"
nohup npm run start > "$LOGS_DIR/frontend.log" 2>&1 &
FRONTEND_PID=$!
echo $FRONTEND_PID > "$LOGS_DIR/frontend.pid"
echo -e "  ${GREEN}▶ Frontend${NC}  started  (PID ${FRONTEND_PID})"
echo -e "     URL  →  ${CYAN}http://localhost:4201${NC}"
echo -e "     Log  →  ${CYAN}logs/frontend.log${NC}"

echo ""

# --- Backend ---
cd "$BACKEND_DIR"
nohup $UVICORN main:app --reload --port 8000 > "$LOGS_DIR/backend.log" 2>&1 &
BACKEND_PID=$!
echo $BACKEND_PID > "$LOGS_DIR/backend.pid"
echo -e "  ${GREEN}▶ Backend${NC}   started  (PID ${BACKEND_PID})"
echo -e "     URL  →  ${CYAN}http://localhost:8000${NC}"
echo -e "     Log  →  ${CYAN}logs/backend.log${NC}"

echo ""
echo -e "${GREEN}✔ Both services are running in the background.${NC}"
echo -e "  • Follow logs:  ${CYAN}tail -f logs/frontend.log logs/backend.log${NC}"
echo -e "  • Stop all:     ${CYAN}./stop.sh${NC}"
echo ""
