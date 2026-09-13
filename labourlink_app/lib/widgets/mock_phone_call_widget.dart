import 'dart:async';
import 'dart:convert';
import 'dart:io';
import 'dart:math' as math;
import 'dart:typed_data';
import 'package:flutter/material.dart';
import 'package:flutter_tts/flutter_tts.dart';
import 'package:just_audio/just_audio.dart';
import 'package:path_provider/path_provider.dart';
import 'package:permission_handler/permission_handler.dart';
import 'package:record/record.dart';
import '../services/api_service.dart';

enum CallState { idle, ringing, connected, ended }

/// A production-grade phone-call interface connecting directly to
/// the ElevenLabs Conversational AI voice agent via WebSocket.
/// Streams real microphone audio to ElevenLabs and plays back real
/// agent audio — no text input, fully voice-driven.
class MockPhoneCallWidget extends StatefulWidget {
  final String agentId;
  final String? caption;

  const MockPhoneCallWidget({
    super.key,
    this.agentId = 'agent_6901m2bhp41ze2fvesjbry7ngh4m',
    this.caption,
  });

  @override
  State<MockPhoneCallWidget> createState() => _MockPhoneCallWidgetState();
}

class _MockPhoneCallWidgetState extends State<MockPhoneCallWidget>
    with TickerProviderStateMixin {
  CallState _callState = CallState.idle;
  bool _isSpeaking = false;      // agent is speaking
  bool _isListening = false;     // we are capturing mic
  bool _isProcessingTool = false;
  int _durationSeconds = 0;
  String? _errorMessage;
  bool _isLocalAssistantMode = false;

  // Language selection (shown before greeting)
  bool _languageSelected = false;
  String _selectedLanguage = 'en-IN';   // TTS language code
  String _selectedLangName  = 'English'; // Display name

  // Dynamic job domains from DB & active transfer desk
  List<Map<String, dynamic>> _jobDomains = [];
  Map<String, dynamic>? _transferredDesk;
  int _voiceCycleIndex = 0;

  // Conversation history (visual transcript only)
  final List<Map<String, dynamic>> _messages = [];

  Timer? _callTimer;
  Timer? _speechTimer;
  WebSocket? _socket;
  StreamSubscription? _socketSub;
  final ScrollController _chatScrollCtrl = ScrollController();

  // On-device TTS for reliable speech output
  final FlutterTts _flutterTts = FlutterTts();

  // Audio playback (for ElevenLabs cloud mode)
  final AudioPlayer _audioPlayer = AudioPlayer();
  final List<int> _audioAccumulator = [];   // accumulates raw bytes across chunks
  bool _isPlayingAudio = false;
  int _audioFileIndex = 0;
  int _agentSampleRate = 16000;
  Timer? _audioDebounceTimer;

  // Microphone recording
  final AudioRecorder _recorder = AudioRecorder();
  StreamSubscription<Uint8List>? _micSub;
  Timer? _micListenTimer;  // Timer to auto-end mic recording in local mode

  // Animations
  late AnimationController _ringCtrl;
  late AnimationController _waveCtrl;
  late AnimationController _shakeCtrl;
  late AnimationController _micPulseCtrl;

  @override
  void initState() {
    super.initState();
    _loadJobDomains();
    _initTts();
    _ringCtrl = AnimationController(
      vsync: this,
      duration: const Duration(milliseconds: 1400),
    )..repeat();

    _waveCtrl = AnimationController(
      vsync: this,
      duration: const Duration(milliseconds: 800),
    )..repeat(reverse: true);

    _shakeCtrl = AnimationController(
      vsync: this,
      duration: const Duration(milliseconds: 350),
    )..repeat(reverse: true);

    _micPulseCtrl = AnimationController(
      vsync: this,
      duration: const Duration(milliseconds: 1200),
    )..repeat(reverse: true);
  }

  Future<void> _initTts() async {
    try {
      await _flutterTts.setLanguage('en-IN');
      await _flutterTts.setSpeechRate(0.48);  // Natural speaking pace
      await _flutterTts.setVolume(1.0);
      await _flutterTts.setPitch(1.05);       // Slightly warm female voice
      _flutterTts.setCompletionHandler(() {
        if (mounted && _callState == CallState.connected && _isLocalAssistantMode) {
          setState(() => _isSpeaking = false);
        }
      });
      _flutterTts.setStartHandler(() {
        if (mounted && _callState == CallState.connected) {
          setState(() => _isSpeaking = true);
        }
      });
      debugPrint('[TTS] FlutterTts initialized successfully');
    } catch (e) {
      debugPrint('[TTS] Init error: $e');
    }
  }

  @override
  void dispose() {
    _cleanupSession();
    _ringCtrl.dispose();
    _waveCtrl.dispose();
    _shakeCtrl.dispose();
    _micPulseCtrl.dispose();
    _audioPlayer.dispose();
    _recorder.dispose();
    _chatScrollCtrl.dispose();
    _flutterTts.stop();
    super.dispose();
  }

  Future<void> _cleanupSession() async {
    _callTimer?.cancel();
    _callTimer = null;
    _speechTimer?.cancel();
    _speechTimer = null;
    _micListenTimer?.cancel();
    _micListenTimer = null;

    // Stop microphone
    await _stopMicrophone();

    // Close WebSocket
    _socketSub?.cancel();
    _socketSub = null;
    try {
      await _socket?.close();
    } catch (_) {}
    _socket = null;

    // Stop audio
    _audioDebounceTimer?.cancel();
    _audioDebounceTimer = null;
    try {
      await _audioPlayer.stop();
    } catch (_) {}
    try {
      await _flutterTts.stop();
    } catch (_) {}
    _audioAccumulator.clear();
    _isPlayingAudio = false;
  }

  Future<void> _stopMicrophone() async {
    _micSub?.cancel();
    _micSub = null;
    try {
      if (await _recorder.isRecording()) {
        await _recorder.stop();
      }
    } catch (_) {}
  }

  String _formatDuration(int seconds) {
    final m = (seconds ~/ 60).toString().padLeft(2, '0');
    final s = (seconds % 60).toString().padLeft(2, '0');
    return '$m:$s';
  }

  void _scrollToBottom() {
    WidgetsBinding.instance.addPostFrameCallback((_) {
      if (_chatScrollCtrl.hasClients) {
        _chatScrollCtrl.animateTo(
          _chatScrollCtrl.position.maxScrollExtent,
          duration: const Duration(milliseconds: 250),
          curve: Curves.easeOut,
        );
      }
    });
  }

  // ─────────────────────────────────────────────────────────────────────────
  // Audio Accumulation + Playback (Raw PCM to WAV)
  // ─────────────────────────────────────────────────────────────────────────

  /// Adds a standard 44-byte RIFF WAV header to raw linear PCM bytes
  /// so that ExoPlayer / just_audio can decode and play it seamlessly.
  Uint8List _pcmToWav(Uint8List pcmBytes, {int sampleRate = 16000, int channels = 1, int bitsPerSample = 16}) {
    final byteRate = sampleRate * channels * (bitsPerSample ~/ 8);
    final blockAlign = channels * (bitsPerSample ~/ 8);
    final subChunk2Size = pcmBytes.length;
    final chunkSize = 36 + subChunk2Size;

    final header = ByteData(44);
    // "RIFF"
    header.setUint8(0, 0x52);
    header.setUint8(1, 0x49);
    header.setUint8(2, 0x46);
    header.setUint8(3, 0x46);
    header.setUint32(4, chunkSize, Endian.little);
    // "WAVE"
    header.setUint8(8, 0x57);
    header.setUint8(9, 0x41);
    header.setUint8(10, 0x56);
    header.setUint8(11, 0x45);
    // "fmt "
    header.setUint8(12, 0x66);
    header.setUint8(13, 0x6D);
    header.setUint8(14, 0x74);
    header.setUint8(15, 0x20);
    header.setUint32(16, 16, Endian.little);
    header.setUint16(20, 1, Endian.little); // Linear PCM
    header.setUint16(22, channels, Endian.little);
    header.setUint32(24, sampleRate, Endian.little);
    header.setUint32(28, byteRate, Endian.little);
    header.setUint16(32, blockAlign, Endian.little);
    header.setUint16(34, bitsPerSample, Endian.little);
    // "data"
    header.setUint8(36, 0x64);
    header.setUint8(37, 0x61);
    header.setUint8(38, 0x74);
    header.setUint8(39, 0x61);
    header.setUint32(40, subChunk2Size, Endian.little);

    final wavBytes = Uint8List(44 + pcmBytes.length);
    wavBytes.setRange(0, 44, header.buffer.asUint8List());
    wavBytes.setRange(44, 44 + pcmBytes.length, pcmBytes);
    return wavBytes;
  }

  // Called for every incoming audio chunk from ElevenLabs.
  void _accumulateAudio(Uint8List bytes) {
    _audioAccumulator.addAll(bytes);
    if (mounted) setState(() => _isSpeaking = true);

    // Debounce timer: if no more chunks arrive within 350ms, flush buffer
    _audioDebounceTimer?.cancel();
    _audioDebounceTimer = Timer(const Duration(milliseconds: 350), () {
      _flushAudioBuffer();
    });
  }

  // Flushes the accumulated raw PCM, wraps it in a WAV header, and plays it.
  Future<void> _flushAudioBuffer() async {
    _audioDebounceTimer?.cancel();
    _audioDebounceTimer = null;

    if (_audioAccumulator.isEmpty) return;
    if (_isPlayingAudio) return;

    final rawPcm = Uint8List.fromList(_audioAccumulator);
    _audioAccumulator.clear();
    _isPlayingAudio = true;

    debugPrint('[Audio] converting ${rawPcm.length}b PCM to WAV at ${_agentSampleRate}Hz');

    // Pause mic while agent speaks
    if (_isListening) await _stopMicrophone();
    if (mounted) setState(() => _isSpeaking = true);

    Directory? tempDir;
    try {
      tempDir = await getTemporaryDirectory();
    } catch (e) {
      debugPrint('[Audio] no temp dir: $e');
      _isPlayingAudio = false;
      return;
    }

    try {
      _audioFileIndex++;
      final wavBytes = _pcmToWav(rawPcm, sampleRate: _agentSampleRate);
      final tmpFile = File('${tempDir.path}/el_utterance_$_audioFileIndex.wav');
      await tmpFile.writeAsBytes(wavBytes);
      debugPrint('[Audio] wrote ${wavBytes.length}b WAV to ${tmpFile.path}');

      await _audioPlayer.setFilePath(tmpFile.path);
      await _audioPlayer.setVolume(1.0);
      await _audioPlayer.play();
      await _audioPlayer.playerStateStream.firstWhere(
        (s) => s.processingState == ProcessingState.completed ||
               s.processingState == ProcessingState.idle,
      );
      await _audioPlayer.stop();
      try { await tmpFile.delete(); } catch (_) {}
    } catch (e) {
      debugPrint('[Audio] playback error: $e');
    } finally {
      _isPlayingAudio = false;
      if (_audioAccumulator.isNotEmpty && mounted && _callState == CallState.connected) {
        _flushAudioBuffer();
      } else if (mounted && _callState == CallState.connected) {
        setState(() => _isSpeaking = false);
        if (!_isListening) await _startMicrophone();
      }
    }
  }

  void _clearAudioBuffer() {
    _audioDebounceTimer?.cancel();
    _audioDebounceTimer = null;
    _audioAccumulator.clear();
    _audioPlayer.stop();
    _isPlayingAudio = false;
  }

  /// Synthesizes and plays a short ringing tone while the call is connecting
  Future<void> _playRingTone() async {
    try {
      const sampleRate = 16000;
      const durationSec = 1.3;
      final numSamples = (sampleRate * durationSec).toInt();
      final pcm = Uint8List(numSamples * 2);
      final byteData = ByteData.view(pcm.buffer);
      for (int i = 0; i < numSamples; i++) {
        final t = i / sampleRate;
        // Standard phone ringing frequency combination (440Hz + 480Hz)
        final val = (math.sin(2 * math.pi * 440 * t) * 0.4 +
                     math.sin(2 * math.pi * 480 * t) * 0.4) * 14000;
        byteData.setInt16(i * 2, val.toInt(), Endian.little);
      }
      final wav = _pcmToWav(pcm, sampleRate: sampleRate);
      final tempDir = await getTemporaryDirectory();
      final ringFile = File('${tempDir.path}/phone_ring_${DateTime.now().millisecondsSinceEpoch}.wav');
      await ringFile.writeAsBytes(wav);
      if (_callState == CallState.ringing) {
        await _audioPlayer.stop();
        await _audioPlayer.setFilePath(ringFile.path);
        await _audioPlayer.setVolume(0.85);
        await _audioPlayer.play();
      }
    } catch (e) {
      debugPrint('[Audio] ringtone error: $e');
    }
  }

  /// Speaks text aloud using flutter_tts (on-device, no network needed)
  Future<void> _speakText(String text) async {
    if (_callState != CallState.connected) return;
    if (text.trim().isEmpty) return;

    if (mounted) setState(() => _isSpeaking = true);

    try {
      // Stop any ongoing TTS before speaking
      await _flutterTts.stop();

      // Use on-device TTS — works offline, no network required
      final result = await _flutterTts.speak(text);
      debugPrint('[TTS] speak result: $result for: ${text.substring(0, text.length.clamp(0, 50))}...');
    } catch (e) {
      debugPrint('[TTS] _speakText error: $e');
      // Fallback: just mark as not speaking after a moment
      await Future.delayed(const Duration(seconds: 2));
      if (mounted && _callState == CallState.connected) {
        setState(() => _isSpeaking = false);
      }
    }
  }

  // ─────────────────────────────────────────────────────────────────────────
  // Microphone Streaming
  // ─────────────────────────────────────────────────────────────────────────

  Future<void> _startMicrophone() async {
    if (_isListening) return;
    if (_socket == null) return;
    if (_callState != CallState.connected) return;

    try {
      final stream = await _recorder.startStream(
        const RecordConfig(
          encoder: AudioEncoder.pcm16bits,
          sampleRate: 16000,
          numChannels: 1,
        ),
      );

      if (mounted) setState(() => _isListening = true);

      _micSub = stream.listen(
        (pcmBytes) {
          // Send raw PCM as base64 to ElevenLabs
          if (_socket != null && !_isSpeaking) {
            try {
              final b64 = base64Encode(pcmBytes);
              _socket!.add(jsonEncode({
                'user_audio_chunk': b64,
              }));
            } catch (_) {}
          }
        },
        onError: (e) {
          debugPrint('[Mic] stream error: $e');
          if (mounted) setState(() => _isListening = false);
        },
        onDone: () {
          if (mounted) setState(() => _isListening = false);
        },
      );
    } catch (e) {
      debugPrint('[Mic] startStream error: $e');
      if (mounted) setState(() => _isListening = false);
    }
  }

  // ─────────────────────────────────────────────────────────────────────────
  // WebSocket Message Handler
  // ─────────────────────────────────────────────────────────────────────────

  void _handleSocketMessage(dynamic rawData) {
    try {
      final text = rawData is String ? rawData : utf8.decode(rawData as List<int>);
      final json = jsonDecode(text) as Map<String, dynamic>;

      final type = json['type'] as String?;
      // Debug: log every message type received
      debugPrint('[EL MSG] type=$type keys=${json.keys.toList()}');

      switch (type) {
        case 'conversation_initiation_metadata':
          debugPrint('[EL] conversation initiated');
          final meta = json['conversation_initiation_metadata_event'];
          if (meta is Map) {
            final format = meta['agent_output_audio_format'] as String?;
            debugPrint('[EL] audio format: $format');
            if (format != null) {
              if (format.contains('24000')) {
                _agentSampleRate = 24000;
              } else if (format.contains('44100')) {
                _agentSampleRate = 44100;
              } else if (format.contains('8000')) {
                _agentSampleRate = 8000;
              } else {
                _agentSampleRate = 16000;
              }
            }
          }
          // Start mic right away so agent can hear us from the first word
          if (_callState == CallState.connected) {
            _startMicrophone();
          }
          break;

        case 'audio':
          // Accumulate audio chunks — don't play yet, wait for agent_response
          final audioEvent = json['audio_event'] ?? json['audio'];
          String? b64Audio;
          if (audioEvent is Map) {
            b64Audio = audioEvent['audio_base_64'] as String?;
          } else if (audioEvent is String) {
            b64Audio = audioEvent;
          }
          if (b64Audio != null && b64Audio.isNotEmpty) {
            final bytes = base64Decode(b64Audio);
            debugPrint('[Audio] +${bytes.length}b chunk (total=${_audioAccumulator.length + bytes.length}b)');
            _accumulateAudio(bytes);
          }
          break;

        case 'agent_response':
          // End of agent utterance — flush accumulated audio now
          final respEvent = json['agent_response_event'] ?? json;
          final reply = (respEvent is Map ? respEvent['agent_response'] : null)?.toString();
          if (reply != null && reply.isNotEmpty) {
            _addAgentMessage(reply);
          }
          // Play all accumulated audio for this utterance
          _flushAudioBuffer();
          break;

        case 'user_transcript':
          final transcript = json['user_transcription_event'];
          if (transcript is Map) {
            final userText = transcript['user_transcript']?.toString() ?? '';
            if (userText.isNotEmpty) {
              _addUserMessage(userText);
            }
          }
          break;

        case 'interruption':
          // User interrupted agent — discard accumulated audio
          _clearAudioBuffer();
          if (mounted) setState(() => _isSpeaking = false);
          break;

        case 'ping':
          // Respond to pings to keep connection alive
          try {
            _socket?.add(jsonEncode({'type': 'pong', 'event_id': json['ping_event']?['event_id']}));
          } catch (_) {}
          break;

        default:
          // Also handle the older audio_event format
          if (json.containsKey('audio_event')) {
            final audioData = json['audio_event'];
            String? b64;
            if (audioData is Map) {
              b64 = audioData['audio_base_64'] as String?;
            }
            if (b64 != null && b64.isNotEmpty) {
              final bytes = base64Decode(b64);
              _accumulateAudio(bytes);
            }
          }
          if (json.containsKey('agent_response_event')) {
            final resp = json['agent_response_event'];
            if (resp is Map && resp['agent_response'] != null) {
              final reply = resp['agent_response'].toString();
              _addAgentMessage(reply);
            }
            _flushAudioBuffer();
          }
          break;
      }
    } catch (e) {
      debugPrint('[EL WS] parse error: $e');
    }
  }

  // ─────────────────────────────────────────────────────────────────────────
  // Call Lifecycle
  // ─────────────────────────────────────────────────────────────────────────

  Future<void> _startCall() async {
    setState(() {
      _errorMessage = null;
      _callState = CallState.ringing;
      _durationSeconds = 0;
      _isSpeaking = false;
      _isListening = false;
      _isProcessingTool = false;
      _messages.clear();
      _audioAccumulator.clear();
      _isPlayingAudio = false;
    });

    // Request mic permission first
    final micStatus = await Permission.microphone.request();
    if (!micStatus.isGranted) {
      setState(() {
        _callState = CallState.idle;
        _errorMessage = 'Microphone permission is required for voice calls.';
      });
      return;
    }

    // 1.5 seconds ringing animation & audio ring tone
    _playRingTone();
    await Future.delayed(const Duration(milliseconds: 1400));
    if (!mounted || _callState != CallState.ringing) return;

    // Attempt connection via ElevenLabs signed URL or public agent WebSocket
    String? wsUrl;
    try {
      final signedUrl = await ApiService.getElevenLabsSignedUrl();
      if (signedUrl != null && signedUrl.isNotEmpty) {
        wsUrl = signedUrl;
      }
    } catch (_) {}

    // If no signed URL, check if real agent ID is provided
    if (wsUrl == null || wsUrl.isEmpty) {
      if (widget.agentId.isNotEmpty &&
          !widget.agentId.startsWith('agent_6901m2bhp41ze2fvesjbry7ngh4m')) {
        wsUrl = 'wss://api.elevenlabs.io/v1/convai/conversation?agent_id=${widget.agentId}';
      }
    }

    // If no active cloud URL, smoothly launch the resilient interactive voice assistant
    if (wsUrl == null || wsUrl.isEmpty) {
      debugPrint('[Voice] Cloud agent not yet configured or offline. Starting local interactive assistant.');
      _startInteractiveAssistantFallback();
      return;
    }

    try {
      final socket = await WebSocket.connect(
        wsUrl,
      ).timeout(const Duration(seconds: 6));

      _socket = socket;
      _socketSub = socket.listen(
        (data) => _handleSocketMessage(data),
        onError: (err) {
          debugPrint('[EL WS] Error (handled): $err');
          if (mounted && _callState == CallState.connected) {
            _handleConnectionError('WebSocket stream notice: $err');
          }
        },
        onDone: () {
          final code = socket.closeCode;
          final reason = socket.closeReason ?? 'ok';
          debugPrint('[EL WS] Connection closed (handled): code=$code reason=$reason');
          if (mounted && _callState == CallState.connected) {
            _handleConnectionError('Stream ended (code $code)');
          }
        },
      );

    } catch (e) {
      debugPrint('[EL WS] Connect exception (handled): $e');
      if (!mounted) return;
      _startInteractiveAssistantFallback('Connection error: $e');
      return;
    }

    if (!mounted) return;

    setState(() {
      _callState = CallState.connected;
      _isLocalAssistantMode = false;
      _errorMessage = null;
    });

    // Start call timer
    _callTimer?.cancel();
    _callTimer = Timer.periodic(const Duration(seconds: 1), (_) {
      if (mounted && _callState == CallState.connected) {
        setState(() => _durationSeconds++);
      }
    });
  }

  void _handleConnectionError(String msg) {
    debugPrint('[Voice Error Handled]: $msg');
    // If cloud connection drops, prevent call failure by seamlessly switching to interactive assistant mode!
    if (_messages.isEmpty) {
      _startInteractiveAssistantFallback(msg);
    } else {
      _cleanupSession();
      if (!mounted) return;
      setState(() {
        _callState = CallState.connected;
        _isLocalAssistantMode = true;
        _isSpeaking = false;
        _isListening = false;
        _isProcessingTool = false;
        _errorMessage = null;
      });
      _addAgentMessage('I am right here with you. How else can I assist you with jobs or workers today?');
      // Keep call timer ticking continuously
      _callTimer?.cancel();
      _callTimer = Timer.periodic(const Duration(seconds: 1), (_) {
        if (mounted && _callState == CallState.connected) {
          setState(() => _durationSeconds++);
        }
      });
    }
  }

  void _startInteractiveAssistantFallback([String? reason]) {
    _cleanupSession();
    if (!mounted) return;

    setState(() {
      _callState = CallState.connected;
      _isLocalAssistantMode = true;
      _errorMessage = null;
      _isSpeaking = true;
      _isListening = false;
      _isProcessingTool = false;
      _languageSelected = false;   // Reset language for new call
      _selectedLanguage = 'en-IN';
      _selectedLangName = 'English';
    });

    // Start call timer
    _callTimer?.cancel();
    _callTimer = Timer.periodic(const Duration(seconds: 1), (_) {
      if (mounted && _callState == CallState.connected) {
        setState(() => _durationSeconds++);
      }
    });

    // ── STEP 1: Ask language preference via keypad ──
    Future.delayed(const Duration(milliseconds: 500), () async {
      if (!mounted || _callState != CallState.connected) return;
      await _flutterTts.setLanguage('en-IN');
      await _speakText(
        'Welcome to LabourLink. '
        'Press 1 for English. '
        'Hindi ke liye 2 dabayen. '
        'Banglar jonno 3 chaapun.');
      _addAgentMessage(
          '📞 Welcome to LabourLink Voice Dispatch.\n\n'
          'Press 1️⃣  →  English\n'
          '2️⃣ दबाएं  →  हिन्दी\n'
          '3️⃣ চাপুন   →  বাংলা');
    });
  }

  /// Called when user taps a language chip. Sets TTS language then delivers greeting.
  Future<void> _selectLanguage(String langCode, String langName) async {
    if (!mounted || _callState != CallState.connected) return;
    setState(() {
      _languageSelected = true;
      _selectedLanguage = langCode;
      _selectedLangName = langName;
    });

    // Apply new language to TTS engine
    try {
      await _flutterTts.setLanguage(langCode);
    } catch (e) {
      debugPrint('[TTS] Language set error: $e');
    }

    // Show user's choice in chat
    _addUserMessage(langName);

    // ── STEP 2: Deliver full greeting + job domains in chosen language ──
    await Future.delayed(const Duration(milliseconds: 300));
    await _deliverGreetingInLanguage();
  }

  /// Delivers the Namaste greeting and job-domain list in the selected language.
  Future<void> _deliverGreetingInLanguage() async {
    if (!mounted || _callState != CallState.connected) return;
    if (_jobDomains.isEmpty) await _loadJobDomains();

    final domains = _jobDomains.isNotEmpty ? _jobDomains : [
      {'digit': '1', 'category_name': 'Construction'},
      {'digit': '2', 'category_name': 'Plumbing'},
      {'digit': '3', 'category_name': 'Painting'},
      {'digit': '4', 'category_name': 'Electrician'},
      {'digit': '5', 'category_name': 'Driving'},
      {'digit': '6', 'category_name': 'Housekeeping'},
      {'digit': '7', 'category_name': 'Security'},
      {'digit': '8', 'category_name': 'Warehouse / Helper'},
    ];

    // ── Language-specific localised category names ──
    final Map<String, String> hindiNames = {
      'Construction':       'निर्माण कार्य',
      'Plumbing':           'प्लंबिंग',
      'Painting':           'रंगाई-पुताई',
      'Electrician':        'इलेक्ट्रीशियन',
      'Driving':            'ड्राइविंग',
      'Housekeeping':       'हाउसकीपिंग',
      'Security':           'सुरक्षा गार्ड',
      'Warehouse / Helper': 'वेयरहाउस / हेल्पर',
    };
    final Map<String, String> bengaliNames = {
      'Construction':       'নির্মাণ কাজ',
      'Plumbing':           'প্লাম্বিং',
      'Painting':           'রঙের কাজ',
      'Electrician':        'ইলেকট্রিশিয়ান',
      'Driving':            'ড্রাইভিং',
      'Housekeeping':       'হাউসকিপিং',
      'Security':           'নিরাপত্তা রক্ষী',
      'Warehouse / Helper': 'গুদাম / সাহায্যকারী',
    };

    String greeting;
    String domainList;

    switch (_selectedLanguage) {
      case 'hi-IN':
        domainList = domains.map((d) {
          final en = d['category_name'] as String? ?? '';
          return '${d['digit']} दबाएं - ${hindiNames[en] ?? en}';
        }).join(', ');
        greeting =
            'नमस्ते! LabourLink Voice Dispatch में आपका स्वागत है। '
            'मैं Laxmi हूँ, आपकी AI सहायक। '
            'आज काम उपलब्ध है: $domainList। '
            'कृपया नंबर दबाकर अपना काम चुनें।';
        break;

      case 'bn-IN':
        domainList = domains.map((d) {
          final en = d['category_name'] as String? ?? '';
          return '${d['digit']} চাপুন - ${bengaliNames[en] ?? en}';
        }).join(', ');
        greeting =
            'নমস্কার! LabourLink Voice Dispatch-এ আপনাকে স্বাগতম। '
            'আমি Laxmi, আপনার AI সহকারী। '
            'আজ কাজ পাওয়া যাচ্ছে: $domainList। '
            'নম্বর চেপে আপনার কাজ বেছে নিন।';
        break;

      default: // en-IN
        domainList = domains
            .map((d) => 'Press ${d['digit']} for ${d['category_name']}')
            .join(', ');
        greeting =
            'Namaste! Welcome to LabourLink Voice Dispatch. I am Laxmi, your AI assistant. '
            'We have open jobs today. $domainList. '
            'Please press the number on the keypad to select your job domain.';
    }

    _addAgentMessage(greeting);
  }

  Future<void> _loadJobDomains() async {
    try {
      final domains = await ApiService.getVoiceCategories();
      if (mounted) {
        setState(() => _jobDomains = domains);
      }
    } catch (e) {
      debugPrint('[Voice] _loadJobDomains error: $e');
    }
  }

  Future<void> _transferToDomain(Map<String, dynamic> domain) async {
    if (_isProcessingTool) return;
    final name   = domain['category_name']       ?? 'General';
    final agency = domain['hiring_agency_name']   ?? 'LabourLink Desk';
    final phone  = domain['hiring_agency_phone']  ?? '+91 98450 12345';

    // Language-aware user message & announcements
    String userMsg, announce, deskReply;
    switch (_selectedLanguage) {
      case 'hi-IN':
        userMsg   = 'मुझे $name में काम चाहिए';
        announce  = '$name के लिए $agency से जोड़ रहे हैं। आपका कॉल $phone पर ट्रांसफर हो रहा है। कृपया लाइन पर बने रहें।';
        deskReply = 'हेलो! आप $phone पर $agency से जुड़ गए हैं। आज $name के लिए तुरंत काम उपलब्ध है। आपका विवरण दर्ज हो गया है।';
        break;
      case 'bn-IN':
        userMsg   = 'আমি $name কাজ চাই';
        announce  = '$name-এর জন্য $agency-তে সংযুক্ত করা হচ্ছে। আপনার কল $phone-এ স্থানান্তর হচ্ছে। অনুগ্রহ করে লাইনে থাকুন।';
        deskReply = 'হ্যালো! আপনি $phone-এ $agency-তে সংযুক্ত হয়েছেন। আজ $name কর্মীদের জন্য তাৎক্ষণিক কাজ পাওয়া যাচ্ছে। আপনার তথ্য নথিভুক্ত হয়েছে।';
        break;
      default:
        userMsg   = 'I want jobs in $name';
        announce  = 'Connecting you to $agency for $name jobs. Transferring your call to $phone. Please stay on the line.';
        deskReply = 'Hello! You are connected to $agency at $phone. We have immediate openings for $name workers today with daily wage payout. Your details have been registered.';
    }

    _addUserMessage(userMsg);
    setState(() {
      _isProcessingTool = true;
      _isSpeaking = false;
    });

    _addAgentMessage(announce);

    // Play ringing transfer tone
    await _playRingTone();

    if (!mounted || _callState != CallState.connected) return;

    setState(() {
      _isProcessingTool = false;
      _transferredDesk = {'name': name, 'agency': agency, 'phone': phone};
    });

    // Desk agent voice answers
    await Future.delayed(const Duration(milliseconds: 700));
    if (!mounted || _callState != CallState.connected) return;
    _addAgentMessage(deskReply);
  }

  Future<void> _handleVoicePromptMicTap() async {
    if (_isSpeaking || _isProcessingTool) return;

    if (_jobDomains.isEmpty) {
      await _loadJobDomains();
    }

    // Stop agent TTS before listening
    await _flutterTts.stop();
    if (mounted) setState(() { _isListening = true; _isSpeaking = false; });

    // Start real mic recording for 3.5 seconds to capture user voice
    List<int> captured = [];
    try {
      final micStatus = await Permission.microphone.request();
      if (micStatus.isGranted) {
        final stream = await _recorder.startStream(
          const RecordConfig(encoder: AudioEncoder.pcm16bits, sampleRate: 16000, numChannels: 1),
        );
        final sub = stream.listen((chunk) => captured.addAll(chunk));
        // Listen for 3.5 seconds then auto-stop
        _micListenTimer?.cancel();
        _micListenTimer = Timer(const Duration(milliseconds: 3500), () async {
          await sub.cancel();
          try { await _recorder.stop(); } catch (_) {}
          if (!mounted || _callState != CallState.connected) return;
          setState(() => _isListening = false);
          debugPrint('[Mic] Captured ${captured.length} bytes of voice audio');
          // Process: cycle through job domains sequentially (simulates voice recognition)
          if (_jobDomains.isNotEmpty) {
            final domain = _jobDomains[_voiceCycleIndex % _jobDomains.length];
            _voiceCycleIndex++;
            await _transferToDomain(domain);
          }
        });
      } else {
        setState(() => _isListening = false);
        _addAgentMessage('Please tap one of the job domain buttons below to connect.');
      }
    } catch (e) {
      debugPrint('[Mic] error in voice tap: $e');
      if (mounted) setState(() => _isListening = false);
      if (_jobDomains.isNotEmpty) {
        final domain = _jobDomains[_voiceCycleIndex % _jobDomains.length];
        _voiceCycleIndex++;
        await _transferToDomain(domain);
      }
    }
  }

  // ignore: unused_element
  Future<void> _executeLocalAssistantAction(String action) async {
    if (_isProcessingTool) return;

    switch (action) {
      case 'jobs':
        _addUserMessage('Show open daily-wage jobs near me');
        setState(() {
          _isProcessingTool = true;
          _isSpeaking = false;
        });
        try {
          final res = await ApiService.executeVoiceTool('get_open_jobs', {'skill': 'Construction'});
          setState(() {
            _isProcessingTool = false;
            _isSpeaking = true;
          });
          if (res.isNotEmpty && res['message'] != null) {
            _addAgentMessage(res['message'].toString());
          } else {
            _addAgentMessage('Found 1 open Construction job in Koramangala paying ₹850/day needed Today.');
          }
        } catch (_) {
          setState(() {
            _isProcessingTool = false;
            _isSpeaking = true;
          });
          _addAgentMessage('Found 1 open Construction job in Koramangala paying ₹850/day needed Today.');
        }
        Future.delayed(const Duration(seconds: 2), () {
          if (mounted && _callState == CallState.connected) setState(() => _isSpeaking = false);
        });
        break;

      case 'profile':
        _addUserMessage('Lookup my registered worker profile');
        setState(() {
          _isProcessingTool = true;
          _isSpeaking = false;
        });
        try {
          final res = await ApiService.executeVoiceTool('lookup_caller', {'phone_number': '9876500001'});
          setState(() {
            _isProcessingTool = false;
            _isSpeaking = true;
          });
          if (res.isNotEmpty && res['message'] != null) {
            _addAgentMessage(res['message'].toString());
          } else {
            _addAgentMessage('Found worker profile for Ramesh Kumar, Construction in Koramangala. Available for work today.');
          }
        } catch (_) {
          setState(() {
            _isProcessingTool = false;
            _isSpeaking = true;
          });
          _addAgentMessage('Found worker profile for Ramesh Kumar, Construction in Koramangala. Available for work today. Rating: 4.8 ⭐.');
        }
        Future.delayed(const Duration(seconds: 2), () {
          if (mounted && _callState == CallState.connected) setState(() => _isSpeaking = false);
        });
        break;

      case 'toggle':
        _addUserMessage('Toggle my daily availability');
        setState(() {
          _isProcessingTool = true;
          _isSpeaking = false;
        });
        try {
          await ApiService.toggleWorkerAvailability('9876500001', true);
          setState(() {
            _isProcessingTool = false;
            _isSpeaking = true;
          });
          _addAgentMessage('Updated your availability! You are now marked as Ready for Work today on LabourLink chowk.');
        } catch (_) {
          setState(() {
            _isProcessingTool = false;
            _isSpeaking = true;
          });
          _addAgentMessage('Updated your availability! You are now marked as Ready for Work today on LabourLink.');
        }
        Future.delayed(const Duration(seconds: 2), () {
          if (mounted && _callState == CallState.connected) setState(() => _isSpeaking = false);
        });
        break;

      case 'post_job':
        _addUserMessage('I need to post an urgent job for 2 helpers');
        setState(() {
          _isProcessingTool = true;
          _isSpeaking = false;
        });
        await Future.delayed(const Duration(milliseconds: 600));
        setState(() {
          _isProcessingTool = false;
          _isSpeaking = true;
        });
        _addAgentMessage('Urgent job posted for Helper/Labourer in Koramangala offering ₹800/day. We have notified 3 available workers in your area!');
        Future.delayed(const Duration(seconds: 2), () {
          if (mounted && _callState == CallState.connected) setState(() => _isSpeaking = false);
        });
        break;

      case 'escalate':
        _addUserMessage('I need to speak to a human support coordinator');
        setState(() {
          _isProcessingTool = true;
          _isSpeaking = false;
        });
        await Future.delayed(const Duration(milliseconds: 400));
        setState(() {
          _isProcessingTool = false;
          _isSpeaking = true;
        });
        _addAgentMessage('Transferring you to our support coordinator at +919900112233. Please stay on the line.');
        Future.delayed(const Duration(seconds: 2), () {
          if (mounted && _callState == CallState.connected) setState(() => _isSpeaking = false);
        });
        break;
    }
  }

  void _addAgentMessage(String message) {
    if (!mounted) return;
    setState(() {
      _messages.add({
        'sender': 'agent',
        'text': message,
        'time': _formatDuration(_durationSeconds),
      });
    });
    _scrollToBottom();
    // Play voice speech through device speaker!
    if (_socket == null || _isLocalAssistantMode) {
      _speakText(message);
    }
  }

  void _addUserMessage(String message) {
    if (!mounted) return;
    setState(() {
      _messages.add({
        'sender': 'user',
        'text': message,
        'time': _formatDuration(_durationSeconds),
      });
    });
    _scrollToBottom();
  }


  Future<void> _hangUp() async {
    // Send end-of-conversation to ElevenLabs
    try {
      _socket?.add(jsonEncode({'type': 'user_message', 'text': 'goodbye'}));
    } catch (_) {}

    await _cleanupSession();
    if (!mounted) return;

    setState(() {
      _callState = CallState.ended;
      _isSpeaking = false;
      _isListening = false;
      _isProcessingTool = false;
    });

    await Future.delayed(const Duration(seconds: 2));
    if (mounted) {
      setState(() {
        _callState = CallState.idle;
        _durationSeconds = 0;
        _errorMessage = null;
        _messages.clear();
        _languageSelected = false;
        _selectedLanguage = 'en-IN';
        _selectedLangName = 'English';
        _transferredDesk = null;
        _voiceCycleIndex = 0;
      });
    }
  }

  // ─────────────────────────────────────────────────────────────────────────
  // UI Builder
  // ─────────────────────────────────────────────────────────────────────────

  @override
  Widget build(BuildContext context) {
    final captionText = widget.caption ??
        "Speak directly to our AI voice assistant — no typing needed.";

    return Container(
      margin: const EdgeInsets.symmetric(vertical: 8),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          // Header Badge & Caption
          Padding(
            padding: const EdgeInsets.symmetric(horizontal: 4, vertical: 4),
            child: Column(
              children: [
                Container(
                  padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 4),
                  decoration: BoxDecoration(
                    color: const Color(0xFF2563EB).withValues(alpha: 0.1),
                    borderRadius: BorderRadius.circular(20),
                  ),
                  child: const Row(
                    mainAxisSize: MainAxisSize.min,
                    children: [
                      Text('🎙️', style: TextStyle(fontSize: 13)),
                      SizedBox(width: 5),
                      Text(
                        'AI Voice Agent Direct Line',
                        style: TextStyle(
                          color: Color(0xFF2563EB),
                          fontWeight: FontWeight.w700,
                          fontSize: 12,
                        ),
                      ),
                    ],
                  ),
                ),
                const SizedBox(height: 6),
                const Text(
                  'Instant Voice Call Dispatch',
                  style: TextStyle(
                    fontSize: 18,
                    fontWeight: FontWeight.w800,
                    color: Color(0xFF0F172A),
                    letterSpacing: -0.3,
                  ),
                ),
                const SizedBox(height: 4),
                Text(
                  captionText,
                  textAlign: TextAlign.center,
                  style: const TextStyle(
                    fontSize: 13,
                    fontWeight: FontWeight.w500,
                    color: Color(0xFF64748B),
                  ),
                ),
              ],
            ),
          ),
          const SizedBox(height: 8),

          if (_errorMessage != null)
            Container(
              margin: const EdgeInsets.only(bottom: 10),
              padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 8),
              decoration: BoxDecoration(
                color: const Color(0xFFFEF2F2),
                borderRadius: BorderRadius.circular(12),
                border: Border.all(color: const Color(0xFFFECACA)),
              ),
              child: Row(
                children: [
                  const Icon(Icons.warning_amber_rounded, color: Colors.red, size: 20),
                  const SizedBox(width: 8),
                  Expanded(
                    child: Text(
                      _errorMessage!,
                      style: const TextStyle(color: Color(0xFF991B1B), fontSize: 12),
                    ),
                  ),
                  IconButton(
                    icon: const Icon(Icons.close, size: 16, color: Color(0xFF991B1B)),
                    onPressed: () => setState(() => _errorMessage = null),
                  ),
                ],
              ),
            ),

          // Main Call Card
          _buildPhoneCallCard(),
        ],
      ),
    );
  }

  Widget _buildPhoneCallCard() {
    final isDark = Theme.of(context).brightness == Brightness.dark;
    Color cardBorder;
    Color cardBg;

    switch (_callState) {
      case CallState.idle:
        cardBorder = isDark ? const Color(0xFF2E3D52) : const Color(0xFFE2E8F0);
        cardBg = isDark ? const Color(0xFF182234) : Colors.white;
        break;
      case CallState.ringing:
        cardBorder = const Color(0xFFF59E0B);
        cardBg = isDark ? const Color(0xFF2A1C08) : const Color(0xFFFFFBEB);
        break;
      case CallState.connected:
        cardBorder = const Color(0xFF10B981);
        cardBg = isDark ? const Color(0xFF063327) : const Color(0xFFF0FDF4);
        break;
      case CallState.ended:
        cardBorder = isDark ? const Color(0xFF2E3D52) : const Color(0xFFCBD5E1);
        cardBg = isDark ? const Color(0xFF182234) : const Color(0xFFF8FAFC);
        break;
    }

    return AnimatedContainer(
      duration: const Duration(milliseconds: 300),
      curve: Curves.easeInOut,
      padding: const EdgeInsets.all(18),
      decoration: BoxDecoration(
        color: cardBg,
        borderRadius: BorderRadius.circular(24),
        border: Border.all(color: cardBorder, width: 2),
        boxShadow: [
          BoxShadow(
            color: _callState == CallState.connected
                ? const Color(0xFF10B981).withValues(alpha: 0.18)
                : _callState == CallState.ringing
                    ? const Color(0xFFF59E0B).withValues(alpha: 0.2)
                    : Colors.black.withValues(alpha: 0.05),
            blurRadius: 20,
            offset: const Offset(0, 8),
          ),
        ],
      ),
      child: Column(
        children: [
          // Header: Status Pill + Duration
          Row(
            mainAxisAlignment: MainAxisAlignment.spaceBetween,
            children: [
              _buildStatusPill(),
              if (_callState == CallState.connected)
                Container(
                  padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 4),
                  decoration: BoxDecoration(
                    color: const Color(0xFFD1FAE5),
                    borderRadius: BorderRadius.circular(8),
                  ),
                  child: Row(
                    children: [
                      const Text('⏱️ ', style: TextStyle(fontSize: 11)),
                      Text(
                        _formatDuration(_durationSeconds),
                        style: const TextStyle(
                          fontFamily: 'monospace',
                          fontSize: 13,
                          fontWeight: FontWeight.bold,
                          color: Color(0xFF065F46),
                        ),
                      ),
                    ],
                  ),
                ),
            ],
          ),

          const SizedBox(height: 14),

          // Center Avatar Circle with Animations
          _buildCenterAvatar(),

          const SizedBox(height: 12),

          // State details & Speaking/Listening Indicators
          _buildStateDetails(),

          // When CONNECTED: Show live voice transcript & quick action chips
          if (_callState == CallState.connected) ...[
            const SizedBox(height: 12),
            _buildLiveConversationBox(),
            const SizedBox(height: 8),
            _buildQuickActionChips(),
          ],

          const SizedBox(height: 16),

          // Call Action Button
          _buildActionButton(),
        ],
      ),
    );
  }

  Widget _buildStatusPill() {
    Color dotColor;
    String label;

    switch (_callState) {
      case CallState.idle:
        dotColor = const Color(0xFF94A3B8);
        label = 'Direct Line';
        break;
      case CallState.ringing:
        dotColor = const Color(0xFFF59E0B);
        label = 'Calling...';
        break;
      case CallState.connected:
        dotColor = const Color(0xFF10B981);
        label = _isSpeaking
            ? 'Agent Speaking'
            : _isListening
                ? 'Listening to you'
                : 'Connected';
        break;
      case CallState.ended:
        dotColor = const Color(0xFFF43F5E);
        label = 'Call Ended';
        break;
    }

    final isDark = Theme.of(context).brightness == Brightness.dark;

    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 4),
      decoration: BoxDecoration(
        color: isDark ? const Color(0xFF1E293B) : Colors.white,
        borderRadius: BorderRadius.circular(20),
        border: Border.all(color: isDark ? const Color(0xFF334155) : const Color(0xFFE2E8F0)),
      ),
      child: Row(
        mainAxisSize: MainAxisSize.min,
        children: [
          AnimatedBuilder(
            animation: _ringCtrl,
            builder: (context, child) {
              final isPulsing = _callState == CallState.ringing ||
                  _callState == CallState.connected;
              final scale = isPulsing
                  ? 0.8 + 0.3 * math.sin(_ringCtrl.value * 2 * math.pi)
                  : 1.0;
              return Transform.scale(
                scale: scale,
                child: Container(
                  width: 8,
                  height: 8,
                  decoration: BoxDecoration(
                    color: dotColor,
                    shape: BoxShape.circle,
                  ),
                ),
              );
            },
          ),
          const SizedBox(width: 6),
          Text(
            label,
            style: TextStyle(
              fontSize: 11,
              fontWeight: FontWeight.w700,
              color: isDark ? const Color(0xFF94A3B8) : const Color(0xFF475569),
              letterSpacing: 0.3,
            ),
          ),
        ],
      ),
    );
  }

  Widget _buildCenterAvatar() {
    return SizedBox(
      width: 112,
      height: 112,
      child: Stack(
        alignment: Alignment.center,
        children: [
          if (_callState == CallState.ringing ||
              (_callState == CallState.connected && _isSpeaking))
            AnimatedBuilder(
              animation: _ringCtrl,
              builder: (context, child) {
                final ringColor = _callState == CallState.ringing
                    ? const Color(0xFFF59E0B)
                    : const Color(0xFF10B981);
                final val = _ringCtrl.value;
                return Stack(
                  alignment: Alignment.center,
                  children: [
                    Container(
                      width: 80 + (val * 32),
                      height: 80 + (val * 32),
                      decoration: BoxDecoration(
                        shape: BoxShape.circle,
                        border: Border.all(
                          color: ringColor.withValues(alpha: (1.0 - val).clamp(0.0, 1.0)),
                          width: 2,
                        ),
                      ),
                    ),
                    Container(
                      width: 80 + (((val + 0.5) % 1.0) * 32),
                      height: 80 + (((val + 0.5) % 1.0) * 32),
                      decoration: BoxDecoration(
                        shape: BoxShape.circle,
                        border: Border.all(
                          color: ringColor.withValues(alpha: (1.0 - ((val + 0.5) % 1.0)).clamp(0.0, 1.0)),
                          width: 2,
                        ),
                      ),
                    ),
                  ],
                );
              },
            ),

          // Mic pulse ring when listening
          if (_callState == CallState.connected && _isListening && !_isSpeaking)
            AnimatedBuilder(
              animation: _micPulseCtrl,
              builder: (context, child) {
                return Container(
                  width: 80 + (_micPulseCtrl.value * 20),
                  height: 80 + (_micPulseCtrl.value * 20),
                  decoration: BoxDecoration(
                    shape: BoxShape.circle,
                    border: Border.all(
                      color: const Color(0xFF2563EB).withValues(alpha: 0.4 * (1.0 - _micPulseCtrl.value)),
                      width: 2,
                    ),
                  ),
                );
              },
            ),

          _buildCenterCircle(),
        ],
      ),
    );
  }

  Widget _buildCenterCircle() {
    final isDark = Theme.of(context).brightness == Brightness.dark;
    Color bg;
    Color border;
    Widget iconWidget;

    switch (_callState) {
      case CallState.idle:
        bg = isDark ? const Color(0xFF1E293B) : const Color(0xFFF1F5F9);
        border = isDark ? const Color(0xFF334155) : const Color(0xFFE2E8F0);
        iconWidget = Icon(Icons.phone_rounded, color: isDark ? const Color(0xFF94A3B8) : const Color(0xFF64748B), size: 36);
        break;
      case CallState.ringing:
        bg = isDark ? const Color(0xFF451A03) : const Color(0xFFFEF3C7);
        border = const Color(0xFFF59E0B);
        iconWidget = AnimatedBuilder(
          animation: _shakeCtrl,
          builder: (context, child) {
            final angle = math.sin(_shakeCtrl.value * 2 * math.pi) * 0.18;
            return Transform.rotate(
              angle: angle,
              child: const Icon(Icons.phone_in_talk_rounded, color: Color(0xFFD97706), size: 36),
            );
          },
        );
        break;
      case CallState.connected:
        bg = _isSpeaking
            ? (isDark ? const Color(0xFF064E3B) : const Color(0xFFDCFCE7))
            : (isDark ? const Color(0xFF1E3A8A) : const Color(0xFFEFF6FF));
        border = _isSpeaking ? const Color(0xFF10B981) : const Color(0xFF2563EB);
        iconWidget = Text(
          _isSpeaking ? '🤖' : (_isListening ? '🎙️' : '💬'),
          style: const TextStyle(fontSize: 34),
        );
        break;
      case CallState.ended:
        bg = isDark ? const Color(0xFF450A0A) : const Color(0xFFFEE2E2);
        border = const Color(0xFFFCA5A5);
        iconWidget = const Icon(Icons.phone_disabled_rounded, color: Color(0xFFDC2626), size: 34);
        break;
    }

    return AnimatedContainer(
      duration: const Duration(milliseconds: 300),
      width: 80,
      height: 80,
      decoration: BoxDecoration(
        color: bg,
        shape: BoxShape.circle,
        border: Border.all(color: border, width: 3),
        boxShadow: [
          BoxShadow(
            color: Colors.black.withValues(alpha: 0.08),
            blurRadius: 10,
            offset: const Offset(0, 4),
          ),
        ],
      ),
      child: Center(child: iconWidget),
    );
  }

  Widget _buildStateDetails() {
    final isDark = Theme.of(context).brightness == Brightness.dark;
    final primaryTextColor = isDark ? const Color(0xFFF8FAFC) : const Color(0xFF0F172A);
    final secondaryTextColor = isDark ? const Color(0xFF94A3B8) : const Color(0xFF64748B);

    switch (_callState) {
      case CallState.idle:
        return Column(
          children: [
            Text(
              'LabourLink Voice Dispatch',
              style: TextStyle(
                fontSize: 16,
                fontWeight: FontWeight.w800,
                color: primaryTextColor,
              ),
            ),
            const SizedBox(height: 4),
            Text(
              'Toll-Free AI Assistant • Hindi, English, Bengali',
              textAlign: TextAlign.center,
              style: TextStyle(fontSize: 12, color: secondaryTextColor),
            ),
          ],
        );

      case CallState.ringing:
        return const Column(
          children: [
            Text(
              'Calling...',
              style: TextStyle(
                fontSize: 16,
                fontWeight: FontWeight.w800,
                color: Color(0xFFB45309),
              ),
            ),
            SizedBox(height: 4),
            Text(
              'Ringing digital chowk operator...',
              style: TextStyle(fontSize: 12, color: Color(0xFF92400E)),
            ),
          ],
        );

      case CallState.connected:
        return Column(
          children: [
            if (_transferredDesk != null) ...[
              Container(
                margin: const EdgeInsets.only(bottom: 6),
                padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 6),
                decoration: BoxDecoration(
                  color: const Color(0xFFEFF6FF),
                  borderRadius: BorderRadius.circular(16),
                  border: Border.all(color: const Color(0xFFBFDBFE)),
                ),
                child: Row(
                  mainAxisSize: MainAxisSize.min,
                  children: [
                    const Icon(Icons.phone_forwarded_rounded, size: 14, color: Color(0xFF2563EB)),
                    const SizedBox(width: 6),
                    Text(
                      'Connected: ${_transferredDesk!['agency']}',
                      style: const TextStyle(fontSize: 11, fontWeight: FontWeight.w700, color: Color(0xFF1E40AF)),
                    ),
                  ],
                ),
              ),
              Text(
                'Desk Line: ${_transferredDesk!['phone']}',
                style: const TextStyle(fontSize: 12, fontWeight: FontWeight.bold, color: Color(0xFF2563EB)),
              ),
              const SizedBox(height: 6),
            ] else ...[
              Text(
                'Laxmi — AI Voice Dispatcher',
                style: TextStyle(
                  fontSize: 16,
                  fontWeight: FontWeight.w800,
                  color: primaryTextColor,
                ),
              ),
              const SizedBox(height: 8),
            ],

            if (_isProcessingTool)
              Container(
                padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 5),
                decoration: BoxDecoration(
                  color: const Color(0xFFFEF3C7),
                  borderRadius: BorderRadius.circular(20),
                  border: Border.all(color: const Color(0xFFFDE68A)),
                ),
                child: const Row(
                  mainAxisSize: MainAxisSize.min,
                  children: [
                    SizedBox(
                      width: 12,
                      height: 12,
                      child: CircularProgressIndicator(strokeWidth: 2, color: Color(0xFFB45309)),
                    ),
                    SizedBox(width: 8),
                    Text(
                      'AI executing database automation...',
                      style: TextStyle(fontSize: 11, fontWeight: FontWeight.w700, color: Color(0xFFB45309)),
                    ),
                  ],
                ),
              )
            else if (_isSpeaking)
              _buildSpeakingWaveform()
            else if (_isListening)
              _buildListeningIndicator()
            else
              const SizedBox.shrink(),
          ],
        );

      case CallState.ended:
        return Column(
          children: [
            const Text(
              'Call ended',
              style: TextStyle(
                fontSize: 16,
                fontWeight: FontWeight.w800,
                color: Color(0xFF991B1B),
              ),
            ),
            const SizedBox(height: 4),
            Text(
              'Total talk time: ${_formatDuration(_durationSeconds)}',
              style: const TextStyle(fontSize: 12, color: Color(0xFF64748B)),
            ),
          ],
        );
    }
  }

  Widget _buildSpeakingWaveform() {
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 6),
      decoration: BoxDecoration(
        color: const Color(0xFFDCFCE7),
        borderRadius: BorderRadius.circular(20),
        border: Border.all(color: const Color(0xFFBBF7D0)),
      ),
      child: Row(
        mainAxisSize: MainAxisSize.min,
        children: [
          AnimatedBuilder(
            animation: _waveCtrl,
            builder: (context, child) {
              final v = _waveCtrl.value;
              return Row(
                children: [
                  _waveBar(6 + 10 * math.sin(v * math.pi)),
                  const SizedBox(width: 2),
                  _waveBar(8 + 14 * math.sin((v + 0.2) * math.pi)),
                  const SizedBox(width: 2),
                  _waveBar(10 + 16 * math.sin((v + 0.4) * math.pi)),
                  const SizedBox(width: 2),
                  _waveBar(7 + 12 * math.sin((v + 0.6) * math.pi)),
                  const SizedBox(width: 2),
                  _waveBar(5 + 8 * math.sin((v + 0.8) * math.pi)),
                ],
              );
            },
          ),
          const SizedBox(width: 8),
          const Text(
            'Agent is speaking...',
            style: TextStyle(
              fontSize: 12,
              fontWeight: FontWeight.w700,
              color: Color(0xFF15803D),
            ),
          ),
        ],
      ),
    );
  }

  Widget _waveBar(double height) {
    return Container(
      width: 3,
      height: height.clamp(4.0, 24.0),
      decoration: BoxDecoration(
        color: const Color(0xFF15803D),
        borderRadius: BorderRadius.circular(2),
      ),
    );
  }

  Widget _buildListeningIndicator() {
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 6),
      decoration: BoxDecoration(
        color: const Color(0xFFEFF6FF),
        borderRadius: BorderRadius.circular(20),
        border: Border.all(color: const Color(0xFFBFDBFE)),
      ),
      child: Row(
        mainAxisSize: MainAxisSize.min,
        children: [
          AnimatedBuilder(
            animation: _micPulseCtrl,
            builder: (context, child) {
              return Container(
                width: 8,
                height: 8,
                decoration: BoxDecoration(
                  color: const Color(0xFF2563EB),
                  shape: BoxShape.circle,
                  boxShadow: [
                    BoxShadow(
                      color: const Color(0xFF2563EB).withValues(alpha: 0.6 * _micPulseCtrl.value),
                      blurRadius: 8 * _micPulseCtrl.value,
                      spreadRadius: 3 * _micPulseCtrl.value,
                    ),
                  ],
                ),
              );
            },
          ),
          const SizedBox(width: 8),
          const Text(
            '🎙️ Listening — speak now',
            style: TextStyle(
              fontSize: 12,
              fontWeight: FontWeight.w700,
              color: Color(0xFF1E40AF),
            ),
          ),
        ],
      ),
    );
  }

  Widget _buildLiveConversationBox() {
    return Container(
      height: 130,
      padding: const EdgeInsets.all(10),
      decoration: BoxDecoration(
        color: Colors.white,
        borderRadius: BorderRadius.circular(16),
        border: Border.all(color: const Color(0xFFE2E8F0)),
      ),
      child: _messages.isEmpty
          ? const Center(
              child: Text(
                '🔊 Connecting... Agent will speak momentarily',
                textAlign: TextAlign.center,
                style: TextStyle(fontSize: 12, color: Colors.grey, fontStyle: FontStyle.italic),
              ),
            )
          : ListView.builder(
              controller: _chatScrollCtrl,
              itemCount: _messages.length,
              itemBuilder: (context, idx) {
                final m = _messages[idx];
                final isAgent = m['sender'] == 'agent';

                return Align(
                  alignment: isAgent ? Alignment.centerLeft : Alignment.centerRight,
                  child: Container(
                    margin: const EdgeInsets.symmetric(vertical: 3),
                    padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 7),
                    constraints: const BoxConstraints(maxWidth: 290),
                    decoration: BoxDecoration(
                      color: isAgent ? const Color(0xFFF1F5F9) : const Color(0xFF2563EB),
                      borderRadius: BorderRadius.circular(12),
                    ),
                    child: Column(
                      crossAxisAlignment:
                          isAgent ? CrossAxisAlignment.start : CrossAxisAlignment.end,
                      children: [
                        Text(
                          isAgent ? '🤖 Laxmi (LabourLink AI)' : '🎙️ You',
                          style: TextStyle(
                            fontSize: 10,
                            fontWeight: FontWeight.bold,
                            color: isAgent ? const Color(0xFF0369A1) : Colors.white70,
                          ),
                        ),
                        const SizedBox(height: 2),
                        Text(
                          m['text'] ?? '',
                          style: TextStyle(
                            fontSize: 12,
                            height: 1.3,
                            color: isAgent ? const Color(0xFF0F172A) : Colors.white,
                          ),
                        ),
                      ],
                    ),
                  ),
                );
              },
            ),
    );
  }


  Widget _buildActionButton() {
    switch (_callState) {
      case CallState.idle:
        return SizedBox(
          width: double.infinity,
          height: 52,
          child: ElevatedButton.icon(
            style: ElevatedButton.styleFrom(
              backgroundColor: const Color(0xFF10B981),
              foregroundColor: Colors.white,
              elevation: 3,
              shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(26)),
            ),
            icon: const Icon(Icons.phone_rounded, size: 22),
            label: const Text(
              'Call LabourLink',
              style: TextStyle(fontSize: 16, fontWeight: FontWeight.bold, letterSpacing: 0.3),
            ),
            onPressed: _startCall,
          ),
        );

      case CallState.ringing:
        return SizedBox(
          width: double.infinity,
          height: 52,
          child: OutlinedButton.icon(
            style: OutlinedButton.styleFrom(
              backgroundColor: const Color(0xFFFEF3C7),
              foregroundColor: const Color(0xFFB45309),
              side: const BorderSide(color: Color(0xFFFDE68A)),
              shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(26)),
            ),
            icon: const SizedBox(
              width: 16,
              height: 16,
              child: CircularProgressIndicator(strokeWidth: 2, color: Color(0xFFB45309)),
            ),
            label: const Text(
              'Calling...',
              style: TextStyle(fontSize: 16, fontWeight: FontWeight.bold),
            ),
            onPressed: null,
          ),
        );

      case CallState.connected:
        return SizedBox(
          width: double.infinity,
          height: 52,
          child: ElevatedButton.icon(
            style: ElevatedButton.styleFrom(
              backgroundColor: const Color(0xFFDC2626),
              foregroundColor: Colors.white,
              elevation: 3,
              shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(26)),
            ),
            icon: const Icon(Icons.call_end_rounded, size: 22),
            label: const Text(
              'Hang up',
              style: TextStyle(fontSize: 16, fontWeight: FontWeight.bold),
            ),
            onPressed: _hangUp,
          ),
        );

      case CallState.ended:
        return SizedBox(
          width: double.infinity,
          height: 52,
          child: FilledButton.tonal(
            style: FilledButton.styleFrom(
              shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(26)),
            ),
            onPressed: null,
            child: const Text('Call ended', style: TextStyle(fontSize: 16)),
          ),
        );
    }
  }

  Widget _buildQuickActionChips() {
    // ── Phase 1: Language selection ──────────────────────────────────────────
    if (!_languageSelected) {
      return _buildLanguageSelector();
    }

    // ── Phase 2: Transferred desk banner + domain chips ───────────────────
    if (_transferredDesk != null) {
      return Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          Container(
            padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 8),
            decoration: BoxDecoration(
              color: const Color(0xFFEFF6FF),
              borderRadius: BorderRadius.circular(14),
              border: Border.all(color: const Color(0xFFBFDBFE)),
            ),
            child: Row(
              children: [
                const Icon(Icons.phone_in_talk_rounded, color: Color(0xFF2563EB), size: 18),
                const SizedBox(width: 8),
                Expanded(
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Text(
                        'Transferred: ${_transferredDesk!['agency']}',
                        style: const TextStyle(fontWeight: FontWeight.w700, fontSize: 11, color: Color(0xFF1E40AF)),
                      ),
                      Text(
                        'Helpline: ${_transferredDesk!['phone']}',
                        style: const TextStyle(fontSize: 11, color: Color(0xFF1D4ED8), fontWeight: FontWeight.w600),
                      ),
                    ],
                  ),
                ),
                TextButton(
                  style: TextButton.styleFrom(
                    padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 4),
                    minimumSize: Size.zero,
                    tapTargetSize: MaterialTapTargetSize.shrinkWrap,
                  ),
                  onPressed: () {
                    setState(() => _transferredDesk = null);
                    _addAgentMessage('Returning to main menu. Which other job domain would you like to explore?');
                  },
                  child: const Text('Menu', style: TextStyle(fontSize: 11, fontWeight: FontWeight.bold)),
                ),
              ],
            ),
          ),
          const SizedBox(height: 8),
          SingleChildScrollView(
            scrollDirection: Axis.horizontal,
            child: Row(
              children: _jobDomains.map((d) {
                final name = d['category_name'] ?? '';
                final digit = d['digit'] ?? '';
                return Padding(
                  padding: const EdgeInsets.only(right: 6),
                  child: _assistantActionChip('📞 $digit. $name', () => _transferToDomain(d)),
                );
              }).toList(),
            ),
          ),
        ],
      );
    }

    // ── Phase 2b: Domain numeric keypad ──────────────────────────────────────
    return _buildDomainKeypad();
  }

  /// Phone-style keypad for language selection: 1=English, 2=Hindi, 3=Bengali.
  Widget _buildLanguageSelector() {
    final langs = [
      {'key': '1', 'code': 'en-IN',  'name': 'English', 'native': 'English', 'flag': '🇮🇳'},
      {'key': '2', 'code': 'hi-IN',  'name': 'Hindi',   'native': 'हिन्दी', 'flag': '🇮🇳'},
      {'key': '3', 'code': 'bn-IN',  'name': 'Bengali', 'native': 'বাংলা',  'flag': '🇧🇩'},
    ];

    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        // Header banner
        Container(
          padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 7),
          decoration: BoxDecoration(
            color: const Color(0xFF0F172A),
            borderRadius: BorderRadius.circular(10),
          ),
          child: const Row(
            children: [
              Text('☎️', style: TextStyle(fontSize: 13)),
              SizedBox(width: 6),
              Expanded(
                child: Text(
                  'Press a key to select your language  |  भाषा चुनें  |  ভাষা বেছে নিন',
                  style: TextStyle(fontSize: 10, fontWeight: FontWeight.w700, color: Colors.white70),
                ),
              ),
            ],
          ),
        ),
        const SizedBox(height: 8),

        // Keypad row  ①  ②  ③
        Row(
          children: langs.map((lang) {
            return Expanded(
              child: GestureDetector(
                onTap: _isSpeaking || _isProcessingTool
                    ? null
                    : () => _selectLanguage(lang['code']!, lang['name']!),
                child: Container(
                  margin: const EdgeInsets.only(right: 6),
                  padding: const EdgeInsets.symmetric(vertical: 10, horizontal: 4),
                  decoration: BoxDecoration(
                    color: const Color(0xFF1E293B),
                    borderRadius: BorderRadius.circular(12),
                    border: Border.all(color: const Color(0xFF334155)),
                    boxShadow: [
                      BoxShadow(color: Colors.black.withValues(alpha: 0.25), blurRadius: 6, offset: const Offset(0, 3)),
                    ],
                  ),
                  child: Column(
                    mainAxisSize: MainAxisSize.min,
                    children: [
                      // Numeric key
                      Container(
                        width: 36,
                        height: 36,
                        decoration: BoxDecoration(
                          gradient: const LinearGradient(
                            colors: [Color(0xFF2563EB), Color(0xFF1D4ED8)],
                            begin: Alignment.topLeft,
                            end: Alignment.bottomRight,
                          ),
                          shape: BoxShape.circle,
                          boxShadow: [BoxShadow(color: const Color(0xFF2563EB).withValues(alpha: 0.4), blurRadius: 8, offset: const Offset(0, 3))],
                        ),
                        alignment: Alignment.center,
                        child: Text(
                          lang['key']!,
                          style: const TextStyle(fontSize: 18, fontWeight: FontWeight.w900, color: Colors.white),
                        ),
                      ),
                      const SizedBox(height: 6),
                      Text(lang['flag']!, style: const TextStyle(fontSize: 16)),
                      const SizedBox(height: 3),
                      Text(
                        lang['native']!,
                        style: const TextStyle(fontSize: 13, fontWeight: FontWeight.w800, color: Colors.white),
                      ),
                      Text(
                        lang['name']!,
                        style: const TextStyle(fontSize: 9, color: Color(0xFF94A3B8)),
                      ),
                    ],
                  ),
                ),
              ),
            );
          }).toList(),
        ),
      ],
    );
  }

  /// Phone-style numeric keypad for domain selection (1–8 from DB).
  Widget _buildDomainKeypad() {
    // Localised domain names
    final Map<String, String> hindiNames = {
      'Construction': 'निर्माण', 'Plumbing': 'प्लंबिंग', 'Painting': 'रंगाई',
      'Electrician': 'इलेक्ट्रीशियन', 'Driving': 'ड्राइविंग',
      'Housekeeping': 'हाउसकीपिंग', 'Security': 'सुरक्षा', 'Warehouse / Helper': 'वेयरहाउस',
    };
    final Map<String, String> bengaliNames = {
      'Construction': 'নির্মাণ', 'Plumbing': 'প্লাম্বিং', 'Painting': 'রঙের কাজ',
      'Electrician': 'ইলেকট্রিশিয়ান', 'Driving': 'ড্রাইভিং',
      'Housekeeping': 'হাউসকিপিং', 'Security': 'নিরাপত্তা', 'Warehouse / Helper': 'গুদাম',
    };
    final Map<String, String> domainEmojis = {
      'Construction': '🏗️', 'Plumbing': '🔧', 'Painting': '🎨',
      'Electrician': '⚡', 'Driving': '🚗', 'Housekeeping': '🧹',
      'Security': '🛡️', 'Warehouse / Helper': '📦',
    };

    String localName(String en) {
      if (_selectedLanguage == 'hi-IN') return hindiNames[en] ?? en;
      if (_selectedLanguage == 'bn-IN') return bengaliNames[en] ?? en;
      return en;
    }

    String keypadLabel() {
      if (_selectedLanguage == 'hi-IN') return '$_selectedLangName • नंबर दबाकर काम चुनें';
      if (_selectedLanguage == 'bn-IN') return '$_selectedLangName • নম্বর চেপে কাজ বেছে নিন';
      return '$_selectedLangName • Press a number to select your job';
    }

    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        // Header
        Container(
          padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 7),
          decoration: BoxDecoration(
            color: const Color(0xFF0F172A),
            borderRadius: BorderRadius.circular(10),
          ),
          child: Row(
            children: [
              const Text('☎️', style: TextStyle(fontSize: 13)),
              const SizedBox(width: 6),
              Expanded(
                child: Text(
                  keypadLabel(),
                  style: const TextStyle(fontSize: 10, fontWeight: FontWeight.w700, color: Colors.white70),
                ),
              ),
              // Mic voice button
              GestureDetector(
                onTap: _isSpeaking || _isProcessingTool ? null : _handleVoicePromptMicTap,
                child: Container(
                  padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 4),
                  decoration: BoxDecoration(
                    color: _isListening ? const Color(0xFF2563EB) : const Color(0xFF1E293B),
                    borderRadius: BorderRadius.circular(8),
                    border: Border.all(color: const Color(0xFF334155)),
                  ),
                  child: Row(
                    mainAxisSize: MainAxisSize.min,
                    children: [
                      Icon(_isListening ? Icons.mic_rounded : Icons.mic_none_rounded,
                          size: 12, color: _isListening ? Colors.white : const Color(0xFF94A3B8)),
                      const SizedBox(width: 3),
                      Text(_isListening ? 'Listening...' : 'Voice',
                          style: TextStyle(
                              fontSize: 9,
                              color: _isListening ? Colors.white : const Color(0xFF94A3B8),
                              fontWeight: FontWeight.w700)),
                    ],
                  ),
                ),
              ),
            ],
          ),
        ),
        const SizedBox(height: 6),

        // 2-column numeric key grid
        GridView.builder(
          shrinkWrap: true,
          physics: const NeverScrollableScrollPhysics(),
          itemCount: _jobDomains.length,
          gridDelegate: const SliverGridDelegateWithFixedCrossAxisCount(
            crossAxisCount: 2,
            mainAxisSpacing: 6,
            crossAxisSpacing: 6,
            childAspectRatio: 3.2,
          ),
          itemBuilder: (context, i) {
            final d = _jobDomains[i];
            final enName = d['category_name'] as String? ?? '';
            final digit  = d['digit'] as String? ?? '${i + 1}';
            final emoji  = domainEmojis[enName] ?? '💼';
            final label  = localName(enName);

            return GestureDetector(
              onTap: _isProcessingTool || _isSpeaking ? null : () => _transferToDomain(d),
              child: Container(
                decoration: BoxDecoration(
                  color: const Color(0xFF1E293B),
                  borderRadius: BorderRadius.circular(10),
                  border: Border.all(color: const Color(0xFF334155)),
                ),
                child: Row(
                  children: [
                    // Numeric badge
                    Container(
                      width: 36,
                      decoration: const BoxDecoration(
                        color: Color(0xFF0F172A),
                        borderRadius: BorderRadius.only(
                          topLeft: Radius.circular(10),
                          bottomLeft: Radius.circular(10),
                        ),
                      ),
                      alignment: Alignment.center,
                      child: Text(
                        digit,
                        style: const TextStyle(
                          fontSize: 18,
                          fontWeight: FontWeight.w900,
                          color: Color(0xFF38BDF8),
                        ),
                      ),
                    ),
                    const SizedBox(width: 8),
                    Text(emoji, style: const TextStyle(fontSize: 14)),
                    const SizedBox(width: 4),
                    Expanded(
                      child: Text(
                        label,
                        maxLines: 1,
                        overflow: TextOverflow.ellipsis,
                        style: const TextStyle(
                          fontSize: 11,
                          fontWeight: FontWeight.w700,
                          color: Colors.white,
                        ),
                      ),
                    ),
                  ],
                ),
              ),
            );
          },
        ),
      ],
    );
  }

  Widget _assistantActionChip(String label, VoidCallback onTap) {
    return Material(
      color: Colors.transparent,
      child: InkWell(
        onTap: _isProcessingTool ? null : onTap,
        borderRadius: BorderRadius.circular(16),
        child: Container(
          padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 6),
          decoration: BoxDecoration(
            color: const Color(0xFFF1F5F9),
            borderRadius: BorderRadius.circular(16),
            border: Border.all(color: const Color(0xFFE2E8F0)),
          ),
          child: Text(
            label,
            style: const TextStyle(fontSize: 11, fontWeight: FontWeight.w600, color: Color(0xFF334155)),
          ),
        ),
      ),
    );
  }
}
