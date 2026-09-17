module.exports = {
  apps: [
    {
      name: "dh-dashboard",
      script: "npm",
      args: "start",
      cwd: "/var/www/dh-smartpower-dashboard",
      instances: 1,
      autorestart: true,
      // SSE 연결이 장시간 유지되므로 메모리 재시작 기준을 넉넉히 둡니다.
      max_memory_restart: "600M",
      env: {
        NODE_ENV: "production",
        PORT: 3000,
      },
      error_file: "/var/log/dh-dashboard/error.log",
      out_file: "/var/log/dh-dashboard/out.log",
      time: true,
    },
    {
      // 알람 발송 워커.
      // alarm_event 통지를 듣고 등록된 수신자에게 메시지를 보냅니다.
      // 같은 알람을 두 번 보내지 않도록 반드시 1벌만 띄웁니다.
      name: "dh-notify",
      script: "scripts/notify-worker.mjs",
      interpreter: "node",
      cwd: "/var/www/dh-smartpower-dashboard",
      instances: 1,
      autorestart: true,
      max_memory_restart: "200M",
      env: {
        NODE_ENV: "production",
      },
      error_file: "/var/log/dh-dashboard/notify-error.log",
      out_file: "/var/log/dh-dashboard/notify-out.log",
      time: true,
    },
  ],
};
