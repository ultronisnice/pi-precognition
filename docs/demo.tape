# pi-precognition headline demo
# Renders to GIF + MP4 + WebM via: vhs docs/demo.tape

Output docs/demo.gif
Output docs/demo.mp4
Output docs/demo.webm

Set Shell "bash"
Set FontSize 18
Set Width 1280
Set Height 720
Set Padding 24
Set Theme "Catppuccin Mocha"
Set TypingSpeed 0ms
Set PlaybackSpeed 1.0

# Run the demo
Hide
Type "clear && bash docs/demo.sh"
Enter
Show
Sleep 100ms

# Let the script run its full course
Sleep 22s
