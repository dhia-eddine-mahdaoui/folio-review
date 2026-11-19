@echo off
"%~dp0node.exe" "%~dp0desktop\cli.mjs" %*
exit /b %errorlevel%
