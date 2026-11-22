#import <Cocoa/Cocoa.h>

extern void goTrayOpen(void);
extern void goTraySettings(void);
extern void goTraySyncNow(void);
extern void goTrayToggleWatch(void);
extern void goTrayQuit(void);

@interface HHTrayDelegate : NSObject {
    NSStatusItem *_statusItem;
    NSMenuItem *_watchItem;
}
@property (nonatomic, retain) NSStatusItem *statusItem;
@property (nonatomic, retain) NSMenuItem *watchItem;
@end

@implementation HHTrayDelegate
@synthesize statusItem = _statusItem;
@synthesize watchItem = _watchItem;
- (void)onOpen:(id)sender { goTrayOpen(); }
- (void)onSettings:(id)sender { goTraySettings(); }
- (void)onSync:(id)sender { goTraySyncNow(); }
- (void)onToggleWatch:(id)sender { goTrayToggleWatch(); }
- (void)onQuit:(id)sender { goTrayQuit(); }
@end

static HHTrayDelegate *hhTray = nil;

void hhSetupTray(const void *pngBytes, int pngLen) {
    NSData *iconData = [[NSData alloc] initWithBytes:pngBytes length:pngLen];
    dispatch_async(dispatch_get_main_queue(), ^{
        if (hhTray != nil) {
            [iconData release];
            return;
        }
        hhTray = [[HHTrayDelegate alloc] init];
        NSStatusItem *item = [[[NSStatusBar systemStatusBar] statusItemWithLength:NSSquareStatusItemLength] retain];
        NSImage *img = [[NSImage alloc] initWithData:iconData];
        [iconData release];
        [img setSize:NSMakeSize(18, 18)];
        [img setTemplate:YES];
        item.button.image = img;
        [img release];
        item.button.toolTip = @"Band of the Helping Hand";

        NSMenu *menu = [[NSMenu alloc] init];
        NSMenuItem *openItem = [[NSMenuItem alloc] initWithTitle:@"Open Helping Hand" action:@selector(onOpen:) keyEquivalent:@""];
        openItem.target = hhTray;
        [menu addItem:openItem];
        [openItem release];

        NSMenuItem *settingsItem = [[NSMenuItem alloc] initWithTitle:@"Settings…" action:@selector(onSettings:) keyEquivalent:@","];
        settingsItem.target = hhTray;
        [menu addItem:settingsItem];
        [settingsItem release];

        [menu addItem:[NSMenuItem separatorItem]];

        NSMenuItem *syncItem = [[NSMenuItem alloc] initWithTitle:@"Sync Now" action:@selector(onSync:) keyEquivalent:@""];
        syncItem.target = hhTray;
        [menu addItem:syncItem];
        [syncItem release];

        NSMenuItem *watchItem = [[NSMenuItem alloc] initWithTitle:@"Stop Auto-Sync" action:@selector(onToggleWatch:) keyEquivalent:@""];
        watchItem.target = hhTray;
        [menu addItem:watchItem];
        hhTray.watchItem = watchItem;
        [watchItem release];

        [menu addItem:[NSMenuItem separatorItem]];

        NSMenuItem *quitItem = [[NSMenuItem alloc] initWithTitle:@"Quit Helping Hand" action:@selector(onQuit:) keyEquivalent:@"q"];
        quitItem.target = hhTray;
        [menu addItem:quitItem];
        [quitItem release];

        item.menu = menu;
        [menu release];
        hhTray.statusItem = item;
        [item release];
    });
}

void hhUpdateWatchLabel(int watching) {
    dispatch_async(dispatch_get_main_queue(), ^{
        if (hhTray != nil && hhTray.watchItem != nil) {
            hhTray.watchItem.title = watching ? @"Stop Auto-Sync" : @"Start Auto-Sync";
        }
    });
}
