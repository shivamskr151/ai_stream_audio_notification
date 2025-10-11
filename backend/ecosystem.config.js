module.exports = {
    apps: [
      {
        name: "qa-backend",
        script: "server.js",
        cwd: "/home/crane/ai_audio_notification/backend",
        instances: 1,            // Or 'max' for all CPU cores
        exec_mode: "fork",       // Or 'cluster'
        env_file: ".env",
        error_file: "./logs/err.log",
        out_file: "./logs/out.log",
        log_date_format: "YYYY-MM-DD HH:mm:ss",
        time: true
      }
    ]
  };
  