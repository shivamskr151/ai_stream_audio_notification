const ffmpeg = require('fluent-ffmpeg');
const EventEmitter = require('events');
const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');

class RTSPProcessor extends EventEmitter {
    constructor(options = {}) {
        super();
        this.rtspUrl = options.rtspUrl || process.env.RTSP_URL || 'rtsp://admin:password@192.168.1.100:554/stream1';
        this.isStreaming = false;
        this.ffmpegProcess = null;
        this.frameBuffer = [];
        this.maxBufferSize = 10; // Keep last 10 frames
        this.frameRate = options.frameRate || 30;
        this.width = options.width || 1280;
        this.height = options.height || 720;
        this.bitrate = options.bitrate || '2000k';
    }

    async startStream() {
        if (this.isStreaming) {
            console.log('RTSP stream is already running');
            return;
        }

        console.log(`Starting RTSP stream from: ${this.rtspUrl}`);
        
        // Check if RTSP is supported, if not use fallback directly
        const isRtsp = this.rtspUrl.startsWith('rtsp://');
        
        if (isRtsp) {
            console.log('RTSP URL detected, attempting to connect to live stream...');
            this.startWebRTCStream();
            return;
        }
        
        try {
            // Use FFmpeg to capture stream and convert to raw video frames (for non-RTSP sources)
            this.ffmpegProcess = ffmpeg(this.rtspUrl)
                .inputOptions([
                    '-f', 'rawvideo',
                    '-pix_fmt', 'yuv420p',
                    '-s', `${this.width}x${this.height}`,
                    '-r', this.frameRate.toString()
                ])
                .outputOptions([
                    '-f', 'rawvideo',
                    '-pix_fmt', 'yuv420p'
                ])
                .on('start', (commandLine) => {
                    console.log('FFmpeg process started:', commandLine);
                    this.isStreaming = true;
                    this.emit('stream-started');
                })
                .on('error', (err) => {
                    console.error('FFmpeg error:', err);
                    this.isStreaming = false;
                    this.emit('stream-error', err);
                })
                .on('end', () => {
                    console.log('FFmpeg process ended');
                    this.isStreaming = false;
                    this.emit('stream-ended');
                });

            // Pipe the output to process frames
            this.ffmpegProcess.pipe(process.stdout, { end: false });
            
            // Also start WebRTC stream
            this.startWebRTCStream();
            
        } catch (error) {
            console.error('Failed to start stream:', error);
            this.emit('stream-error', error);
        }
    }

    startWebRTCStream() {
        // Use FFmpeg to convert video source to WebRTC-compatible H.264 stream
        const outputPath = path.join(__dirname, '../../public/stream');
        
        // Determine input options based on URL type
        const isRtsp = this.rtspUrl.startsWith('rtsp://');
        const isHttp = this.rtspUrl.startsWith('http://') || this.rtspUrl.startsWith('https://');
        
        let inputOptions = [];
        
        if (isRtsp) {
            // Try to connect to RTSP stream first
            console.log('Attempting to connect to RTSP stream...');
            this.connectToRTSPStream(outputPath);
            return;
        } else if (isHttp) {
            inputOptions = ['-fflags', '+genpts', '-avoid_negative_ts', 'make_zero', '-re', '-stream_loop', '-1'];
        } else {
            inputOptions = ['-fflags', '+genpts', '-avoid_negative_ts', 'make_zero'];
        }
        
        this.ffmpegProcess = ffmpeg(this.rtspUrl)
            .inputOptions(inputOptions)
            .videoCodec('libx264')
            .outputOptions([
                '-preset', 'ultrafast',
                '-tune', 'zerolatency',
                '-profile:v', 'baseline',
                '-level', '3.0',
                '-pix_fmt', 'yuv420p',
                '-g', '30',
                '-keyint_min', '30',
                '-sc_threshold', '0',
                '-b:v', this.bitrate,
                '-maxrate', this.bitrate,
                '-bufsize', '4000k',
                '-f', 'hls',
                '-hls_time', '2',
                '-hls_list_size', '3',
                '-hls_flags', 'delete_segments',
                '-hls_allow_cache', '0'
            ])
            .output(path.join(outputPath, 'stream.m3u8'))
            .on('start', (commandLine) => {
                console.log('WebRTC FFmpeg process started:', commandLine);
                this.isStreaming = true;
                this.emit('stream-started');
            })
            .on('error', (err) => {
                console.error('WebRTC FFmpeg error:', err);
                this.isStreaming = false;
                this.emit('stream-error', err);
            })
            .on('end', () => {
                console.log('WebRTC FFmpeg process ended');
                this.isStreaming = false;
                this.emit('stream-ended');
            })
            .run();
    }

    generateTestPattern(outputPath) {
        // No fallback - only live RTSP stream
        console.log('No fallback available. RTSP connection required for streaming.');
        this.emit('stream-error', new Error('RTSP connection required for live streaming'));
    }

    // Removed: createStaticHLSFiles - only live RTSP streaming supported

    connectToRTSPStream(outputPath) {
        console.log('Connecting to live RTSP stream:', this.rtspUrl);
        
        // Ensure output directory exists
        if (!fs.existsSync(outputPath)) {
            fs.mkdirSync(outputPath, { recursive: true });
            console.log('Created stream directory:', outputPath);
        }
        
        this.ffmpegProcess = ffmpeg(this.rtspUrl)
            .inputOptions([
                '-rtsp_transport', 'tcp',  // Use TCP for better reliability
                '-timeout', '5000000',     // 5 second timeout
                '-analyzeduration', '1000000',  // Analyze stream for 1 second
                '-probesize', '1000000'         // Probe size for better detection
            ])
            .videoCodec('libx264')  // Convert HEVC to H.264 for HLS compatibility
            .outputOptions([
                '-preset', 'ultrafast',
                '-tune', 'zerolatency',
                '-profile:v', 'baseline',
                '-level', '3.0',
                '-pix_fmt', 'yuv420p',
                '-g', '30',
                '-keyint_min', '30',
                '-sc_threshold', '0',
                '-b:v', this.bitrate,
                '-maxrate', this.bitrate,
                '-bufsize', '4000k',
                '-f', 'hls',
                '-hls_time', '2',
                '-hls_list_size', '3',
                '-hls_flags', 'delete_segments+independent_segments',
                '-hls_allow_cache', '0',
                '-hls_segment_type', 'mpegts'
            ])
            .output(path.join(outputPath, 'stream.m3u8'))
            .on('start', (commandLine) => {
                console.log('Live RTSP FFmpeg process started:', commandLine);
                this.isStreaming = true;
                this.emit('stream-started');
            })
            .on('error', (err) => {
                console.error('Live RTSP FFmpeg error:', err);
                console.log('RTSP connection failed. Please check camera connection and credentials.');
                this.isStreaming = false;
                this.emit('stream-error', err);
            })
            .on('end', () => {
                console.log('Live RTSP FFmpeg process ended');
                this.isStreaming = false;
                this.emit('stream-ended');
            })
            .run();
    }

    // Removed: createHLSFromVideo - only live RTSP streaming supported

    // Removed: createTSegment - only live RTSP streaming supported

    async stopStream() {
        if (!this.isStreaming) {
            console.log('RTSP stream is not running');
            return;
        }

        console.log('Stopping RTSP stream...');
        
        if (this.ffmpegProcess) {
            this.ffmpegProcess.kill('SIGTERM');
            this.ffmpegProcess = null;
        }
        
        this.isStreaming = false;
        this.emit('stream-stopped');
    }

    // Get current frame for WebRTC transmission
    getCurrentFrame() {
        if (this.frameBuffer.length > 0) {
            return this.frameBuffer[this.frameBuffer.length - 1];
        }
        return null;
    }

    // Process raw video frame
    processFrame(frameData) {
        // Add frame to buffer
        this.frameBuffer.push(frameData);
        
        // Maintain buffer size
        if (this.frameBuffer.length > this.maxBufferSize) {
            this.frameBuffer.shift();
        }
        
        // Emit frame for WebRTC processing
        this.emit('frame', frameData);
    }

    // Get stream status
    getStatus() {
        return {
            isStreaming: this.isStreaming,
            rtspUrl: this.rtspUrl,
            frameRate: this.frameRate,
            resolution: `${this.width}x${this.height}`,
            bitrate: this.bitrate,
            bufferSize: this.frameBuffer.length
        };
    }

    // Update stream configuration
    updateConfig(config) {
        if (config.frameRate) this.frameRate = config.frameRate;
        if (config.width) this.width = config.width;
        if (config.height) this.height = config.height;
        if (config.bitrate) this.bitrate = config.bitrate;
        if (config.rtspUrl) this.rtspUrl = config.rtspUrl;
        
        console.log('RTSP configuration updated:', this.getStatus());
    }

    // Test video source connection
    async testConnection() {
        return new Promise((resolve, reject) => {
            const isRtsp = this.rtspUrl.startsWith('rtsp://');
            const isHttp = this.rtspUrl.startsWith('http://') || this.rtspUrl.startsWith('https://');
            
            if (isRtsp) {
                // RTSP is not supported, but we can generate test pattern
                console.log('RTSP connection test: Protocol not supported, but test pattern generation available');
                resolve(true);
                return;
            }
            
            let inputOptions = [];
            if (isHttp) {
                inputOptions = ['-re']; // Read at native frame rate for HTTP
            }
            
            const testProcess = ffmpeg(this.rtspUrl)
                .inputOptions(inputOptions)
                .outputOptions(['-t', '5']) // Test for 5 seconds
                .format('null')
                .on('start', () => {
                    const sourceType = isHttp ? 'HTTP' : 'File';
                    console.log(`Testing ${sourceType} connection...`);
                })
                .on('end', () => {
                    const sourceType = isHttp ? 'HTTP' : 'File';
                    console.log(`${sourceType} connection test successful`);
                    resolve(true);
                })
                .on('error', (err) => {
                    const sourceType = isHttp ? 'HTTP' : 'File';
                    console.error(`${sourceType} connection test failed:`, err);
                    reject(err);
                })
                .run();
        });
    }
}

module.exports = RTSPProcessor;
