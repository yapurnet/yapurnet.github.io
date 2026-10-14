package ar.com.banderavuela.favlapp;

import android.content.ContentProvider;
import android.content.ContentValues;
import android.database.Cursor;
import android.database.MatrixCursor;
import android.net.Uri;
import android.os.Environment;
import android.os.ParcelFileDescriptor;
import java.io.File;
import java.io.FileNotFoundException;

// Comparte con otras apps (WhatsApp, correo…) el PDF guardado en Descargas en Android 9 o anterior.
public class SimpleFileProvider extends ContentProvider {
    @Override
    public boolean onCreate() {
        return true;
    }

    private File resolveFile(Uri uri) {
        return new File(Environment.getExternalStoragePublicDirectory(Environment.DIRECTORY_DOWNLOADS), uri.getLastPathSegment());
    }

    @Override
    public ParcelFileDescriptor openFile(Uri uri, String str) throws FileNotFoundException {
        return ParcelFileDescriptor.open(resolveFile(uri), ParcelFileDescriptor.MODE_READ_ONLY);
    }

    @Override
    public String getType(Uri uri) {
        return "application/pdf";
    }

    @Override
    public Cursor query(Uri uri, String[] strArr, String str, String[] strArr2, String str2) {
        File resolveFile = resolveFile(uri);
        MatrixCursor matrixCursor = new MatrixCursor(new String[]{"_display_name", "_size"});
        matrixCursor.addRow(new Object[]{resolveFile.getName(), Long.valueOf(resolveFile.length())});
        return matrixCursor;
    }

    @Override
    public Uri insert(Uri uri, ContentValues contentValues) {
        return null;
    }

    @Override
    public int delete(Uri uri, String str, String[] strArr) {
        return 0;
    }

    @Override
    public int update(Uri uri, ContentValues contentValues, String str, String[] strArr) {
        return 0;
    }
}
