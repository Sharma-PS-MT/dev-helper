#!/bin/bash

# ============================================================
#  Dev-Helper — Stop script
#  Gracefully stops the background frontend and backend
#  services that were started by ./start.sh
# ============================================================

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
LOGS_DIR="$ROOT_DIR/logs"

GREEN='\033[0;32m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
CYAN='\033[0;36m'
NC='\033[0m'

echo ""
echo -e "${CYAN}╔══════════════════════════════════════════════╗${NC}"
echo -e "${CYAN}║        🛑  Dev-Helper Stop Script            ║${NC}"
echo -e "${CYAN}╚══════════════════════════════════════════════╝${NC}"
echo ""

stop_service() {
  local name=$1
  local port=$2
  local pidfile="$LOGS_DIR/${name}.pid"

  if [ -f "$pidfile" ]; then
    local pid
    pid=$(cat "$pidfile")

    if kill -0 "$pid" 2>/dev/null; then
      echo -e "  Stopping ${GREEN}$name${NC} (PID $pid)..."
      
      # On Windows, taskkill /T /F is much more reliable for process trees
      if command -v taskkill &> /dev/null; then
        taskkill //F //T //PID "$pid" 2>/dev/null
      fi
      
      kill "$pid" 2>/dev/null

      # Wait up to 3 seconds for graceful exit
      local waited=0
      while kill -0 "$pid" 2>/dev/null && [ $waited -lt 3 ]; do
        sleep 1
        ((waited++))
      done

      if kill -0 "$pid" 2>/dev/null; then
        echo -e "  ${YELLOW}Force-killing remaining $name process...${NC}"
        kill -9 "$pid" 2>/dev/null
      fi
    fi
    rm -f "$pidfile"
  fi

  # --- Port-based cleanup (fallback) ---
  if [ -n "$port" ]; then
    # Find Windows PID listening on the port
    local port_pid
    port_pid=$(netstat -ano | grep ":$port " | grep "LISTENING" | awk '{print $5}' | head -n 1 | tr -d '\r')
    
    if [ -n "$port_pid" ] && [ "$port_pid" -gt 0 ] 2>/dev/null; then
      echo -e "  ${YELLOW}Port $port still in use (PID $port_pid). Cleaning up...${NC}"
      if command -v taskkill &> /dev/null; then
        taskkill //F //T //PID "$port_pid" 2>/dev/null
      else
        kill -9 "$port_pid" 2>/dev/null
      fi
    fi
  fi
  
  echo -e "  ${GREEN}✔ $name stopped.${NC}"
}

stop_service "frontend" 4201
echo ""
stop_service "backend" 8000

echo ""
echo -e "${GREEN}✔ All services stopped.${NC}"
echo ""
