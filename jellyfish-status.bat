@echo off
if "%1"=="" (
  echo Usage: jellyfish-status ^<state^> [message]
  echo States: idle, thinking, responding, executing, reading, waiting_choice, error, done
  exit /b 1
)
curl -s -X POST http://localhost:19527/status -H "Content-Type: application/json" -d "{\"state\":\"%1\"}" > nul
echo Sent state: %1
