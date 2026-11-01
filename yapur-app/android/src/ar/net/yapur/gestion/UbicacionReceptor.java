package ar.net.yapur.gestion;

import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import android.os.Build;

/**
 * Vuelve a poner en marcha el servicio de ubicación sin que nadie abra la app:
 *   · al terminar de arrancar el celular (BOOT_COMPLETED),
 *   · al actualizar la app a una versión nueva (MY_PACKAGE_REPLACED),
 *   · y cuando suena la alarma de control que deja el propio servicio (por si el sistema lo cerró).
 * Solo actúa si el técnico entró con su usuario, aceptó el aviso y no cerró sesión (UbicacionService.P_ACTIVO).
 * Si Android no deja arrancar el servicio desde segundo plano, muestra la notificación «tocá para activar» (solo en horario de trabajo)
 * y vuelve a intentar con la próxima alarma.
 */
public class UbicacionReceptor extends BroadcastReceiver {
    @Override
    public void onReceive(Context c, Intent i) {
        String a = i == null ? null : i.getAction();
        if (a == null) return;
        if (!Intent.ACTION_BOOT_COMPLETED.equals(a) && !Intent.ACTION_MY_PACKAGE_REPLACED.equals(a) && !UbicacionService.ACCION_ALARMA.equals(a)) return;
        SharedPreferences sp = c.getSharedPreferences(UbicacionService.PREFS, Context.MODE_PRIVATE);
        if (!sp.getBoolean(UbicacionService.P_ACTIVO, false) || sp.getString(UbicacionService.P_TOKEN, "").length() == 0) return;
        try {
            Intent s = new Intent(c, UbicacionService.class);
            if (Build.VERSION.SDK_INT >= 26) {
                Context.class.getMethod("startForegroundService", Intent.class).invoke(c, s);
            } else {
                c.startService(s);
            }
        } catch (Throwable t) {
            if (UbicacionService.cercaDelHorario(sp)) UbicacionService.avisarReactivar(c);
            UbicacionService.alarmaEn(c, 15L * 60000L);
        }
    }
}
