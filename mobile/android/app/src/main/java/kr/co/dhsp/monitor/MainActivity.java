package kr.co.dhsp.monitor;

import android.graphics.Color;
import android.os.Bundle;
import android.view.View;
import android.view.Window;

import androidx.core.graphics.Insets;
import androidx.core.view.ViewCompat;
import androidx.core.view.WindowCompat;
import androidx.core.view.WindowInsetsCompat;
import androidx.core.view.WindowInsetsControllerCompat;

import com.getcapacitor.BridgeActivity;

/**
 * 화면이 상단 상태표시줄(시계·와이파이·배터리)과 하단 내비게이션 바 밑으로
 * 들어가 겹치지 않도록, 시스템 막대 높이만큼 안쪽 여백을 둡니다.
 * 기종·안드로이드 버전(15 이상은 전체 화면이 기본)에 상관없이 같은 결과가 나오게
 * 직접 여백을 계산합니다.
 */
public class MainActivity extends BridgeActivity {
    // 웹 화면 상단 막대와 같은 남색
    private static final int BAR_COLOR = Color.parseColor("#1A2742");

    @Override
    public void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);

        Window window = getWindow();
        WindowCompat.setDecorFitsSystemWindows(window, false);
        window.setStatusBarColor(BAR_COLOR);
        window.setNavigationBarColor(BAR_COLOR);

        // 남색 바탕이므로 상태표시줄 아이콘은 흰색으로
        WindowInsetsControllerCompat bars = WindowCompat.getInsetsController(window, window.getDecorView());
        bars.setAppearanceLightStatusBars(false);
        bars.setAppearanceLightNavigationBars(false);

        View root = findViewById(android.R.id.content);
        root.setBackgroundColor(BAR_COLOR);
        ViewCompat.setOnApplyWindowInsetsListener(root, (v, insets) -> {
            Insets safe = insets.getInsets(
                WindowInsetsCompat.Type.systemBars()
                    | WindowInsetsCompat.Type.displayCutout()
                    | WindowInsetsCompat.Type.ime()
            );
            v.setPadding(safe.left, safe.top, safe.right, safe.bottom);
            return WindowInsetsCompat.CONSUMED;
        });
    }
}
