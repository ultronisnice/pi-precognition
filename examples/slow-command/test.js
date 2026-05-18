// Slow command fixture — 15-second test that pi-precognition can warm
// during operator-draft time. Mirrors the bench's command_test_future workload.
await new Promise((resolve) => setTimeout(resolve, 15_000));
console.log("ok");
