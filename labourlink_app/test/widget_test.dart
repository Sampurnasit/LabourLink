import 'package:flutter_test/flutter_test.dart';
import 'package:labourlink_app/main.dart';

void main() {
  testWidgets('LabourLink app smoke test', (WidgetTester tester) async {
    await tester.pumpWidget(const LabourLinkApp());
    expect(find.text('LabourLink'), findsOneWidget);
  });
}
