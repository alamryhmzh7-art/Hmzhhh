package com.hamza.obdpro;

import android.util.Base64;
import android.util.Log;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

import java.io.InputStream;
import java.io.OutputStream;
import java.net.InetSocketAddress;
import java.net.Socket;
import java.util.Arrays;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;

@CapacitorPlugin(name = "WifiTcpPlugin")
public class WifiTcpPlugin extends Plugin {
    private static final String TAG = "WifiTcpPlugin";

    private Socket socket;
    private InputStream inputStream;
    private OutputStream outputStream;
    private ExecutorService networkExecutor;
    private Thread readThread;
    private volatile boolean isReading = false;

    @Override
    public void load() {
        super.load();
        networkExecutor = Executors.newCachedThreadPool();
    }

    @PluginMethod
    public void connect(PluginCall call) {
        final String ip = call.getString("ip", "192.168.4.1");
        final int port = call.getInt("port", 35000);
        final int timeoutMs = call.getInt("timeoutMs", 5000);

        networkExecutor.execute(() -> {
            try {
                disconnectInternal();

                socket = new Socket();
                socket.setTcpNoDelay(true);
                socket.setKeepAlive(true);
                socket.connect(new InetSocketAddress(ip, port), timeoutMs);

                inputStream = socket.getInputStream();
                outputStream = socket.getOutputStream();

                startReadThread();

                JSObject ret = new JSObject();
                ret.put("connected", true);
                ret.put("ip", ip);
                ret.put("port", port);
                call.resolve(ret);
            } catch (Exception e) {
                Log.e(TAG, "TCP Connect error: " + e.getMessage(), e);
                disconnectInternal();
                call.reject("Failed to connect to " + ip + ":" + port + " - " + e.getMessage());
            }
        });
    }

    @PluginMethod
    public void disconnect(PluginCall call) {
        networkExecutor.execute(() -> {
            disconnectInternal();
            JSObject ret = new JSObject();
            ret.put("disconnected", true);
            call.resolve(ret);
        });
    }

    @PluginMethod
    public void send(PluginCall call) {
        final String base64Data = call.getString("dataBase64");
        final String hexData = call.getString("dataHex");

        networkExecutor.execute(() -> {
            try {
                if (socket == null || !socket.isConnected() || outputStream == null) {
                    call.reject("TCP Socket is not connected");
                    return;
                }

                byte[] bytesToSend;
                if (base64Data != null && !base64Data.isEmpty()) {
                    bytesToSend = Base64.decode(base64Data, Base64.DEFAULT);
                } else if (hexData != null && !hexData.isEmpty()) {
                    bytesToSend = hexToBytes(hexData);
                } else {
                    call.reject("No data provided");
                    return;
                }

                outputStream.write(bytesToSend);
                outputStream.flush();

                JSObject ret = new JSObject();
                ret.put("sentBytes", bytesToSend.length);
                call.resolve(ret);
            } catch (Exception e) {
                Log.e(TAG, "TCP Send error: " + e.getMessage(), e);
                call.reject("TCP Send error: " + e.getMessage());
            }
        });
    }

    @PluginMethod
    public void isConnected(PluginCall call) {
        boolean connected = socket != null && socket.isConnected() && !socket.isClosed();
        JSObject ret = new JSObject();
        ret.put("connected", connected);
        call.resolve(ret);
    }

    private void startReadThread() {
        isReading = true;
        readThread = new Thread(() -> {
            byte[] buffer = new byte[4096];
            while (isReading && socket != null && !socket.isClosed()) {
                try {
                    int bytesRead = inputStream.read(buffer);
                    if (bytesRead == -1) {
                        Log.w(TAG, "TCP Socket EOF reached");
                        break;
                    }
                    if (bytesRead > 0) {
                        byte[] chunk = Arrays.copyOf(buffer, bytesRead);
                        String base64Chunk = Base64.encodeToString(chunk, Base64.NO_WRAP);

                        JSObject event = new JSObject();
                        event.put("dataBase64", base64Chunk);
                        event.put("bytesLength", bytesRead);
                        notifyListeners("dataReceived", event);
                    }
                } catch (Exception e) {
                    if (isReading) {
                        Log.e(TAG, "TCP Read error: " + e.getMessage());
                        JSObject event = new JSObject();
                        event.put("error", e.getMessage());
                        notifyListeners("connectionError", event);
                    }
                    break;
                }
            }
            disconnectInternal();
        });
        readThread.start();
    }

    private synchronized void disconnectInternal() {
        isReading = false;
        try {
            if (inputStream != null) inputStream.close();
        } catch (Exception ignored) {}
        try {
            if (outputStream != null) outputStream.close();
        } catch (Exception ignored) {}
        try {
            if (socket != null) socket.close();
        } catch (Exception ignored) {}
        socket = null;
        inputStream = null;
        outputStream = null;
    }

    private static byte[] hexToBytes(String hex) {
        String cleanHex = hex.replaceAll("[^0-9A-Fa-f]", "");
        int len = cleanHex.length();
        byte[] data = new byte[len / 2];
        for (int i = 0; i < len; i += 2) {
            data[i / 2] = (byte) ((Character.digit(cleanHex.charAt(i), 16) << 4)
                                 + Character.digit(cleanHex.charAt(i+1), 16));
        }
        return data;
    }
}
