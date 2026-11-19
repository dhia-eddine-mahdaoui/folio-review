Set shell = CreateObject("WScript.Shell")
Set files = CreateObject("Scripting.FileSystemObject")
folder = files.GetParentFolderName(WScript.ScriptFullName)
result = shell.Run(Chr(34) & folder & "\node.exe" & Chr(34) & " " & Chr(34) & folder & "\desktop\launch.mjs" & Chr(34), 0, True)
If result <> 0 Then MsgBox "Folio could not open. Check local port 8031 and try again.", 48, "Folio"
