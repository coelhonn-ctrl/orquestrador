@echo off
setlocal
set ELECTRON_RUN_AS_NODE=1
if defined ORQ_NODE (
  "%ORQ_NODE%" "%~dp0orq.mjs" %*
) else (
  node "%~dp0orq.mjs" %*
)
