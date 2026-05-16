import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:provider/provider.dart';
import 'package:sample_shop/data/product_repository.dart';
import 'package:sample_shop/ui/screens/more_screen.dart';

void main() {
  TestWidgetsFlutterBinding.ensureInitialized();

  testWidgets('inline search filters and shows empty state', (tester) async {
    final repo = ProductRepository();
    await repo.load();
    await tester.pumpWidget(Provider<ProductRepository>.value(
      value: repo,
      child: const MaterialApp(home: Scaffold(body: MoreScreen())),
    ));
    await tester.pumpAndSettle();

    expect(find.bySemanticsIdentifier('more_field_name'), findsOneWidget);
    expect(find.bySemanticsIdentifier('more_field_email'), findsOneWidget);
    expect(
        find.bySemanticsIdentifier('more_toggle_notifications'), findsOneWidget);

    await tester.enterText(
        find.bySemanticsIdentifier('more_field_search'), 'Dune');
    await tester.pumpAndSettle();
    expect(find.bySemanticsIdentifier('more_search_result_p007'),
        findsOneWidget);

    await tester.enterText(
        find.bySemanticsIdentifier('more_field_search'), 'zzzzz');
    await tester.pumpAndSettle();
    expect(find.bySemanticsIdentifier('more_search_empty'), findsOneWidget);
  });
}
