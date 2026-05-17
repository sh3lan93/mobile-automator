import 'package:flutter/material.dart';
import 'package:permission_handler/permission_handler.dart';
import 'package:provider/provider.dart';
import 'package:sample_shop/data/product_repository.dart';
import 'package:sample_shop/models/product.dart';

class MoreScreen extends StatefulWidget {
  const MoreScreen({super.key});
  @override
  State<MoreScreen> createState() => _MoreScreenState();
}

class _MoreScreenState extends State<MoreScreen> {
  final _searchCtrl = TextEditingController();
  bool _notifications = false;
  String _query = '';

  @override
  void dispose() {
    _searchCtrl.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final repo = context.read<ProductRepository>();
    final results = _query.isEmpty
        ? const <Product>[]
        : repo.products
            .where((p) =>
                p.title.toLowerCase().contains(_query.toLowerCase()))
            .toList(growable: false);

    return ListView(
      padding: const EdgeInsets.all(16),
      children: [
        Semantics(
          identifier: 'more_field_name',
          textField: true,
          child: const TextField(
              decoration: InputDecoration(labelText: 'Name')),
        ),
        const SizedBox(height: 12),
        Semantics(
          identifier: 'more_field_email',
          textField: true,
          child: const TextField(
              decoration: InputDecoration(labelText: 'Email')),
        ),
        const SizedBox(height: 12),
        Semantics(
          identifier: 'more_toggle_notifications',
          toggled: _notifications,
          child: SwitchListTile(
            title: const Text('Notifications'),
            value: _notifications,
            onChanged: (v) async {
              setState(() => _notifications = v);
              if (v) await Permission.notification.request();
            },
          ),
        ),
        const Divider(),
        Row(
          children: [
            Expanded(
              child: Semantics(
                identifier: 'more_field_search',
                textField: true,
                child: TextField(
                  controller: _searchCtrl,
                  decoration:
                      const InputDecoration(labelText: 'Search products'),
                  onChanged: (v) => setState(() => _query = v),
                ),
              ),
            ),
            Semantics(
              identifier: 'more_button_search_clear',
              button: true,
              child: IconButton(
                icon: const Icon(Icons.clear),
                onPressed: () {
                  _searchCtrl.clear();
                  setState(() => _query = '');
                },
              ),
            ),
          ],
        ),
        if (_query.isNotEmpty && results.isEmpty)
          Semantics(
            identifier: 'more_search_empty',
            child: const Padding(
              padding: EdgeInsets.all(24),
              child: Text('No products match your search.'),
            ),
          ),
        ...results.map(
          (p) => Semantics(
            identifier: 'more_search_result_${p.id}',
            child: ListTile(
                title: Text(p.title),
                trailing: Text('\$${p.price.toStringAsFixed(2)}')),
          ),
        ),
      ],
    );
  }
}
