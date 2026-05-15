#!/usr/bin/env bash
# pi-precognition demo — recreates the headline benchmark in 18 seconds
# Numbers from validation/precog_live_ab_2026-05-15T05-57-56-215Z.md (n=3)

set -e

# Terminal colors
BOLD=$'\033[1m'
DIM=$'\033[2m'
RED=$'\033[31m'
GREEN=$'\033[32m'
YELLOW=$'\033[33m'
BLUE=$'\033[34m'
MAGENTA=$'\033[35m'
CYAN=$'\033[36m'
WHITE=$'\033[37m'
RESET=$'\033[0m'

clear

echo "${DIM}\$${RESET} ${BOLD}pi install npm:pi-precognition${RESET}"
sleep 0.4
echo "${GREEN}✓${RESET} installed ${BOLD}pi-precognition@0.1.0${RESET} ${DIM}(silent-futures mode)${RESET}"
echo
sleep 0.3

echo "${DIM}\$${RESET} ${BOLD}pi-precognition bench --workload slow-command --n 3${RESET}"
sleep 0.4
echo "${DIM}Running A/B benchmark — bash(\"npm test\") with 15s execution time...${RESET}"
echo
sleep 0.5

# OFF arm
echo "  ${RED}●${RESET} ${BOLD}OFF${RESET}  ${DIM}precognition disabled (baseline)${RESET}"
sleep 0.2
echo "     ${DIM}├─${RESET} submit"
sleep 0.15
echo "     ${DIM}├─${RESET} first tool call ${DIM}..............${RESET} 1.2s"
sleep 0.15
printf "     ${DIM}├─${RESET} bash(\"npm test\") "
for i in 1 2 3 4 5 6 7 8 9 10 11 12 13 14 15 16 17 18 19 20; do
  printf "${RED}█${RESET}"
  sleep 0.08
done
echo " ${RED}15234ms${RESET}"
sleep 0.15
echo "     ${DIM}├─${RESET} first tool result ${DIM}............${RESET} ${RED}18.37s${RESET}"
sleep 0.15
echo "     ${DIM}└─${RESET} completion ${DIM}...................${RESET} ${RED}21.91s${RESET}"
echo
sleep 0.6

# ON arm
echo "  ${GREEN}●${RESET} ${BOLD}ON${RESET}   ${DIM}precognition enabled, silent-futures${RESET}"
sleep 0.2
echo "     ${DIM}├─${RESET} submit  ${DIM}(future warmed during draft time)${RESET}"
sleep 0.15
echo "     ${DIM}├─${RESET} first tool call ${DIM}..............${RESET} 1.2s"
sleep 0.15
echo "     ${DIM}├─${RESET} bash(\"npm test\") ${GREEN}▎${RESET} ${GREEN}29ms${RESET} ${DIM}— served from validated future${RESET} ${GREEN}✓${RESET}"
sleep 0.2
echo "     ${DIM}├─${RESET} first tool result ${DIM}............${RESET} ${GREEN}3.16s${RESET}"
sleep 0.15
echo "     ${DIM}└─${RESET} completion ${DIM}...................${RESET} ${GREEN}6.59s${RESET}"
echo
sleep 0.7

# Results box
echo "${CYAN}╭─ Result ─────────────────────────────────────────╮${RESET}"
echo "${CYAN}│${RESET}  blocked tool wait        ${BOLD}${GREEN}522.5x faster${RESET}          ${CYAN}│${RESET}"
echo "${CYAN}│${RESET}  first tool result          ${BOLD}${GREEN}5.82x faster${RESET}          ${CYAN}│${RESET}"
echo "${CYAN}│${RESET}  task completion            ${BOLD}${GREEN}3.32x faster${RESET}          ${CYAN}│${RESET}"
echo "${CYAN}│${RESET}  hidden context injected    ${BOLD}0${RESET}                     ${CYAN}│${RESET}"
echo "${CYAN}│${RESET}  cache hits / misses        ${BOLD}3 / 0${RESET}                 ${CYAN}│${RESET}"
echo "${CYAN}│${RESET}  answer prediction          ${BOLD}none${RESET}                  ${CYAN}│${RESET}"
echo "${CYAN}╰──────────────────────────────────────────────────╯${RESET}"
echo
sleep 0.8
echo "  ${BOLD}${MAGENTA}Predict the wait, not the answer.${RESET}"
sleep 1.5
