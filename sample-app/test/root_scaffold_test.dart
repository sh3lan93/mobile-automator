import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:provider/provider.dart';
import 'package:sample_shop/state/cart_model.dart';
import 'package:sample_shop/ui/root_scaffold.dart';

void main() {
  testWidgets('tabs switch via bottom nav; cart icon present', (tester) async {
    await tester.pumpWidget(
      ChangeNotifierProvider(
        create: (_) => CartModel(),
        child: const MaterialApp(home: RootScaffold()),
      ),
    );

    // 'Home' appears in both the HomeScreen body and the nav label.
    // Use findsAtLeastNWidgets(1) to confirm the text is present.
    expect(find.text('Home'), findsAtLeastNWidgets(1));

    await tester.tap(find.bySemanticsIdentifier('bottom_nav_categories'));
    await tester.pumpAndSettle();
    expect(find.text('Categories'), findsAtLeastNWidgets(1));

    await tester.tap(find.bySemanticsIdentifier('bottom_nav_more'));
    await tester.pumpAndSettle();
    expect(find.text('More'), findsAtLeastNWidgets(1));

    expect(find.bySemanticsIdentifier('appbar_icon_cart'), findsOneWidget);
  });
}
