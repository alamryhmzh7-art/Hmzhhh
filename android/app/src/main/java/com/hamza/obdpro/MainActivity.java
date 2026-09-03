package com.hamza.obdpro;

import android.os.Bundle;
import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {
    @Override
    public void onCreate(Bundle savedInstanceState) {
        registerPlugin(BluetoothSppPlugin.class);
        super.onCreate(savedInstanceState);
    }
}
