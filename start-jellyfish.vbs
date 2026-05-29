Set ws = CreateObject("WScript.Shell")
ws.CurrentDirectory = "D:\jellyfish-pet"
ws.Run "npx electron .", 0, False
