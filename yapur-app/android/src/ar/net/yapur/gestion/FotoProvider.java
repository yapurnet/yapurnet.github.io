package ar.net.yapur.gestion;

import android.content.ContentProvider;
import android.content.ContentValues;
import android.content.Context;
import android.database.Cursor;
import android.database.MatrixCursor;
import android.net.Uri;
import android.os.ParcelFileDescriptor;
import android.provider.OpenableColumns;

import java.io.File;
import java.io.FileNotFoundException;

/* Le presta a la cámara del celular el archivo donde guardar la foto del comprobante (botón «Sacar foto con la cámara»).
   Las fotos quedan en la memoria temporal privada de la app (no en la galería) y se borran al sacar la siguiente.
   Sin esto, Android no deja que otra app (la cámara) escriba dentro de la nuestra. No está exportado: solo recibe
   permiso la cámara a la que le entregamos el enlace, y solo para ese archivo. */
public class FotoProvider extends ContentProvider {
    static final String AUTH = "ar.net.yapur.gestion.fotos";

    static File dir(Context c) {
        File d = new File(c.getCacheDir(), "fotos");
        d.mkdirs();
        return d;
    }

    static Uri uriDe(File f) {
        return Uri.parse("content://" + AUTH + "/" + f.getName());
    }

    /* solo nombres simples dentro de la carpeta de fotos (sin «..» ni barras) */
    private File archivo(Uri u) throws FileNotFoundException {
        String n = u.getLastPathSegment();
        if (n == null || n.startsWith(".") || !n.matches("[A-Za-z0-9_.-]{1,80}")) throw new FileNotFoundException();
        return new File(dir(getContext()), n);
    }

    @Override
    public boolean onCreate() {
        return true;
    }

    @Override
    public ParcelFileDescriptor openFile(Uri uri, String mode) throws FileNotFoundException {
        return ParcelFileDescriptor.open(archivo(uri), ParcelFileDescriptor.parseMode(mode));
    }

    @Override
    public Cursor query(Uri uri, String[] proj, String sel, String[] args, String order) {
        try {
            File f = archivo(uri);
            String[] cols = proj != null ? proj : new String[]{OpenableColumns.DISPLAY_NAME, OpenableColumns.SIZE};
            Object[] row = new Object[cols.length];
            for (int i = 0; i < cols.length; i++) {
                if (OpenableColumns.DISPLAY_NAME.equals(cols[i])) row[i] = f.getName();
                else if (OpenableColumns.SIZE.equals(cols[i])) row[i] = Long.valueOf(f.length());
            }
            MatrixCursor c = new MatrixCursor(cols, 1);
            c.addRow(row);
            return c;
        } catch (FileNotFoundException e) {
            return null;
        }
    }

    @Override
    public String getType(Uri uri) {
        return "image/jpeg";
    }

    @Override
    public Uri insert(Uri uri, ContentValues v) {
        return null;
    }

    @Override
    public int delete(Uri uri, String sel, String[] args) {
        return 0;
    }

    @Override
    public int update(Uri uri, ContentValues v, String sel, String[] args) {
        return 0;
    }
}
