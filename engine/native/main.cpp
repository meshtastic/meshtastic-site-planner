/* Native CLI around the coverage engine, used for golden-file generation
 * and parity testing against the legacy SPLAT! backend (Tier A). Not part
 * of the shipped site - the browser uses the same driver via WebAssembly.
 *
 * Usage:
 *   splat_cli --lat 51.1 --lon -114.1 --txft 2 --rxft 3.28 --freq 907
 *             --erp 66.07 --dielect 15 --cond 0.005 --bend 301
 *             --climate 5 --pol 1 --conf 0.95 --rel 0.95
 *             --clutter-m 1 --radius-km 30
 *             --terrain test/fixtures/terrain.s16 --out /tmp/calgary
 *
 * Terrain pages are raw little-endian int16 files named
 * page_<min_north>_<min_west>.s16 (SDF cell order, 1200x1200); pages
 * without a file behave as sea level, matching SPLAT!.
 *
 * Outputs: <out>.signal.u8, <out>.mask.u8, <out>.meta.json
 */

#include <stdio.h>
#include <stdlib.h>
#include <string.h>

#include <string>
#include <vector>

#include "../driver.h"

static double arg_f(int argc, char **argv, const char *name, bool *found) {
    for (int i = 1; i + 1 < argc; i++) {
        if (strcmp(argv[i], name) == 0) {
            if (found)
                *found = true;
            return atof(argv[i + 1]);
        }
    }
    if (found)
        *found = false;
    return 0.0;
}

static const char *arg_s(int argc, char **argv, const char *name) {
    for (int i = 1; i + 1 < argc; i++)
        if (strcmp(argv[i], name) == 0)
            return argv[i + 1];
    return nullptr;
}

static bool require(bool found, const char *name) {
    if (!found)
        fprintf(stderr, "missing required argument %s\n", name);
    return found;
}

int main(int argc, char **argv) {
    bool ok = true, f;
    double lat = arg_f(argc, argv, "--lat", &f);
    ok &= require(f, "--lat");
    double lon = arg_f(argc, argv, "--lon", &f);
    ok &= require(f, "--lon");
    double txft = arg_f(argc, argv, "--txft", &f);
    ok &= require(f, "--txft");
    double rxft = arg_f(argc, argv, "--rxft", &f);
    ok &= require(f, "--rxft");
    double freq = arg_f(argc, argv, "--freq", &f);
    ok &= require(f, "--freq");
    double erp = arg_f(argc, argv, "--erp", &f);
    ok &= require(f, "--erp");
    double dielect = arg_f(argc, argv, "--dielect", &f);
    ok &= require(f, "--dielect");
    double cond = arg_f(argc, argv, "--cond", &f);
    ok &= require(f, "--cond");
    double bend = arg_f(argc, argv, "--bend", &f);
    ok &= require(f, "--bend");
    int climate = (int)arg_f(argc, argv, "--climate", &f);
    ok &= require(f, "--climate");
    int pol = (int)arg_f(argc, argv, "--pol", &f);
    ok &= require(f, "--pol");
    double conf = arg_f(argc, argv, "--conf", &f);
    ok &= require(f, "--conf");
    double rel = arg_f(argc, argv, "--rel", &f);
    ok &= require(f, "--rel");
    double clutter_m = arg_f(argc, argv, "--clutter-m", &f);
    ok &= require(f, "--clutter-m");
    double radius_km = arg_f(argc, argv, "--radius-km", &f);
    ok &= require(f, "--radius-km");
    const char *terrain_dir = arg_s(argc, argv, "--terrain");
    ok &= require(terrain_dir != nullptr, "--terrain");
    const char *out_prefix = arg_s(argc, argv, "--out");
    ok &= require(out_prefix != nullptr, "--out");
    if (!ok)
        return 2;
    bool has_ippd;
    int ippd = (int)arg_f(argc, argv, "--ippd", &has_ippd);
    if (!has_ippd)
        ippd = 1200;

    int h = splat_create(lat, lon, txft, rxft, freq, erp, dielect, cond, bend,
                         climate, pol, conf, rel, clutter_m, radius_km, ippd);
    if (h < 1) {
        fprintf(stderr, "splat_create failed: %d\n", h);
        return 1;
    }

    int pages = splat_page_count(h);
    std::vector<int16_t> buf((size_t)ippd * (size_t)ippd);
    int loaded = 0;

    for (int i = 0; i < pages; i++) {
        int32_t info[2];
        splat_page_info(h, i, info);
        char path[1024];
        snprintf(path, sizeof(path), "%s/page_%d_%d.s16", terrain_dir,
                 (int)info[0], (int)info[1]);
        FILE *fp = fopen(path, "rb");
        if (!fp) {
            fprintf(stderr, "page %d (%d,%d): no terrain file, sea level\n",
                    i, (int)info[0], (int)info[1]);
            continue;
        }
        size_t n = fread(buf.data(), sizeof(int16_t), buf.size(), fp);
        fclose(fp);
        if (n != buf.size()) {
            fprintf(stderr, "page %d: short read from %s\n", i, path);
            return 1;
        }
        int rc = splat_load_page(h, i, buf.data());
        if (rc < 0) {
            fprintf(stderr, "splat_load_page failed: %d\n", rc);
            return 1;
        }
        loaded++;
    }

    int radials = splat_radial_count(h);
    fprintf(stderr, "pages=%d loaded=%d radials=%d\n", pages, loaded,
            radials);

    const int chunk = 256;
    for (int start = 0; start < radials; start += chunk) {
        int rc = splat_run_radials(h, start, chunk);
        if (rc < 0) {
            fprintf(stderr, "splat_run_radials failed: %d\n", rc);
            return 1;
        }
        if ((start / chunk) % 8 == 0)
            fprintf(stderr, "\r%d/%d radials", start + rc, radials);
    }
    fprintf(stderr, "\r%d/%d radials\n", radials, radials);

    if (splat_rasterize(h) < 0) {
        fprintf(stderr, "splat_rasterize failed\n");
        return 1;
    }

    double info[8];
    splat_region_info(h, info);
    int width = (int)info[0], height = (int)info[1];

    int32_t errs[6];
    splat_errnum_counts(h, errs);

    std::string base(out_prefix);

    FILE *fp = fopen((base + ".signal.u8").c_str(), "wb");
    if (!fp)
        return 1;
    fwrite(splat_signal_ptr(h), 1, (size_t)width * height, fp);
    fclose(fp);

    fp = fopen((base + ".mask.u8").c_str(), "wb");
    if (!fp)
        return 1;
    fwrite(splat_mask_ptr(h), 1, (size_t)width * height, fp);
    fclose(fp);

    fp = fopen((base + ".meta.json").c_str(), "wb");
    if (!fp)
        return 1;
    fprintf(fp,
            "{\n"
            "  \"width\": %d,\n"
            "  \"height\": %d,\n"
            "  \"north\": %.10f,\n"
            "  \"south\": %.10f,\n"
            "  \"east\": %.10f,\n"
            "  \"west\": %.10f,\n"
            "  \"radials\": %d,\n"
            "  \"pages\": %d,\n"
            "  \"pages_loaded\": %d,\n"
            "  \"itm_errnums\": [%d, %d, %d, %d, %d, %d]\n"
            "}\n",
            width, height, info[2], info[3], info[4], info[5], (int)info[6],
            (int)info[7], loaded, errs[0], errs[1], errs[2], errs[3], errs[4],
            errs[5]);
    fclose(fp);

    splat_destroy(h);
    fprintf(stderr, "wrote %s.{signal.u8,mask.u8,meta.json} (%dx%d)\n",
            out_prefix, width, height);
    return 0;
}
